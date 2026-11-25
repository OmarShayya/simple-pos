import PC, { IPC, PCStatus, StationType } from "../models/pc.model";
import GamingSession, {
  SessionPaymentStatus,
  SessionStatus,
} from "../models/gamingsession.model";
import { ApiError } from "../utils/apiError";
import config from "../config/config";
import socketService from "./socket.service";
import gamingSessionService from "./gamingsession.service";

interface PCFilters {
  status?: PCStatus;
  type?: StationType;
  isActive?: boolean;
  page?: number;
  limit?: number;
}

class PCService {
  async createPC(data: {
    type?: StationType;
    pcNumber: string;
    name: string;
    hourlyRateUsd?: number;
    specifications?: any;
    location?: string;
    notes?: string;
  }): Promise<IPC> {
    const existingPC = await PC.findOne({ pcNumber: data.pcNumber });
    if (existingPC) {
      throw ApiError.badRequest("PC number already exists");
    }

    const hourlyRateUsd = data.hourlyRateUsd || 2;
    const hourlyRateLbp = Math.round(
      hourlyRateUsd * config.currency.exchangeRate
    );

    const pc = await PC.create({
      type: data.type || StationType.PC,
      pcNumber: data.pcNumber,
      name: data.name,
      hourlyRate: {
        usd: hourlyRateUsd,
        lbp: hourlyRateLbp,
      },
      specifications: data.specifications,
      location: data.location,
      notes: data.notes,
      status: PCStatus.AVAILABLE,
    });

    return pc;
  }

  async updatePC(
    pcId: string,
    data: {
      type?: StationType;
      pcNumber?: string;
      name?: string;
      hourlyRateUsd?: number;
      specifications?: any;
      location?: string;
      notes?: string;
      status?: PCStatus;
      isActive?: boolean;
    }
  ): Promise<IPC> {
    const pc = await PC.findById(pcId);
    if (!pc) {
      throw ApiError.notFound("PC not found");
    }

    // Check if PC has active session before allowing status changes to maintenance
    if (
      data.status === PCStatus.MAINTENANCE &&
      pc.status === PCStatus.OCCUPIED
    ) {
      const activeSession = await GamingSession.findOne({
        pc: pcId,
        status: SessionStatus.ACTIVE,
      });
      if (activeSession) {
        throw ApiError.badRequest(
          "Cannot set PC to maintenance while it has an active session"
        );
      }
    }

    if (data.pcNumber && data.pcNumber.toUpperCase() !== pc.pcNumber) {
      const clash = await PC.findOne({ pcNumber: data.pcNumber.toUpperCase(), _id: { $ne: pc._id } });
      if (clash) throw ApiError.badRequest("Station number already exists");
      pc.pcNumber = data.pcNumber;
    }
    if (data.type) pc.type = data.type;
    if (data.name) pc.name = data.name;
    if (data.hourlyRateUsd !== undefined) {
      pc.hourlyRate.usd = data.hourlyRateUsd;
      pc.hourlyRate.lbp = Math.round(
        data.hourlyRateUsd * config.currency.exchangeRate
      );
    }
    if (data.specifications) pc.specifications = data.specifications;
    if (data.location !== undefined) pc.location = data.location;
    if (data.notes !== undefined) pc.notes = data.notes;
    if (data.status) pc.status = data.status;
    if (data.isActive !== undefined) pc.isActive = data.isActive;

    await pc.save();
    return pc;
  }

  async getPCById(id: string): Promise<IPC> {
    const pc = await PC.findById(id);
    if (!pc) {
      throw ApiError.notFound("PC not found");
    }
    return pc;
  }

  async getAllPCs(filters: PCFilters): Promise<{
    pcs: IPC[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const { status, type, isActive, page = 1, limit = 50 } = filters;

    const query: any = {};

    if (status) {
      query.status = status;
    }

    if (type) {
      query.type = type;
    }

    if (isActive !== undefined) {
      query.isActive = isActive;
    }

    const skip = (page - 1) * limit;

    const [pcs, total] = await Promise.all([
      PC.find(query).sort({ type: 1, pcNumber: 1 }).skip(skip).limit(limit),
      PC.countDocuments(query),
    ]);

    return {
      pcs,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async deletePC(pcId: string): Promise<void> {
    const pc = await PC.findById(pcId);
    if (!pc) {
      throw ApiError.notFound("PC not found");
    }

    // Check for active sessions
    const activeSession = await GamingSession.findOne({
      pc: pcId,
      status: SessionStatus.ACTIVE,
    });

    if (activeSession) {
      throw ApiError.badRequest("Cannot delete PC with active session");
    }

    await PC.findByIdAndDelete(pcId);
  }

  async getAvailablePCs(): Promise<IPC[]> {
    return await PC.find({
      status: PCStatus.AVAILABLE,
      isActive: true,
    }).sort({ type: 1, pcNumber: 1 });
  }

  async updatePCStatus(pcId: string, status: PCStatus): Promise<IPC> {
    const pc = await PC.findById(pcId);
    if (!pc) {
      throw ApiError.notFound("PC not found");
    }

    pc.status = status;
    await pc.save();
    return pc;
  }

  /**
   * Station "lock" action from the stations admin page: starts a session (which always opens an order).
   * Kept as a thin wrapper so the old endpoint can't create sessions that bypass billing.
   */
  async lockPC(pcId: string, customerId?: string, customerName?: string, startedBy?: string): Promise<IPC> {
    if (!startedBy) throw ApiError.unauthorized("Not authenticated");
    await gamingSessionService.startSession(startedBy, { pcId, customerId, customerName });
    return this.getPCById(pcId);
  }

  /** Station "unlock" action: ends the running session (billing it on its order) and frees the station. */
  async unlockPC(pcId: string, endedBy?: string): Promise<IPC> {
    const pc = await this.getPCById(pcId);
    const ended = endedBy ? await gamingSessionService.endActiveSessionOnStation(pcId, endedBy) : null;
    if (!ended) {
      pc.status = PCStatus.AVAILABLE;
      await pc.save();
      socketService.lockPC(pc.pcNumber);
      return pc;
    }
    return this.getPCById(pcId);
  }

  /** One-off migration: stations created before station types existed are PCs. */
  async backfillStationTypes(): Promise<number> {
    const res = await PC.updateMany({ type: { $exists: false } }, { $set: { type: StationType.PC } });
    return res.modifiedCount;
  }
}

export default new PCService();

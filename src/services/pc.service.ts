import PC, { IPC, PCStatus } from "../models/pc.model";
import GamingSession, {
  SessionPaymentStatus,
  SessionStatus,
} from "../models/gamingsession.model";
import { ApiError } from "../utils/apiError";
import config from "../config/config";

interface PCFilters {
  status?: PCStatus;
  isActive?: boolean;
  page?: number;
  limit?: number;
}

class PCService {
  async createPC(data: {
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
    const { status, isActive, page = 1, limit = 50 } = filters;

    const query: any = {};

    if (status) {
      query.status = status;
    }

    if (isActive !== undefined) {
      query.isActive = isActive;
    }

    const skip = (page - 1) * limit;

    const [pcs, total] = await Promise.all([
      PC.find(query).sort({ pcNumber: 1 }).skip(skip).limit(limit),
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
    }).sort({ pcNumber: 1 });
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

  async lockPC(
    pcId: string,
    customerId?: string,
    customerName?: string,
    startedBy?: string
  ): Promise<IPC> {
    const pc = await PC.findById(pcId);
    if (!pc) {
      throw ApiError.notFound("PC not found");
    }

    if (pc.status === PCStatus.OCCUPIED) {
      throw ApiError.badRequest("PC is already occupied");
    }

    if (!pc.isActive) {
      throw ApiError.badRequest("PC is not active");
    }

    const existingSession = await GamingSession.findOne({
      pc: pcId,
      status: SessionStatus.ACTIVE,
    });

    if (existingSession) {
      throw ApiError.badRequest("PC already has an active session");
    }

    const sessionNumber = await this.generateSessionNumber();

    await GamingSession.create({
      sessionNumber,
      pc: pcId,
      customer: customerId,
      customerName: customerName || "Walk-in",
      startTime: new Date(),
      hourlyRate: pc.hourlyRate,
      startedBy: startedBy, // Use the passed user ID
      status: SessionStatus.ACTIVE,
      paymentStatus: SessionPaymentStatus.UNPAID,
    });

    pc.status = PCStatus.OCCUPIED;
    await pc.save();

    return pc;
  }

  async unlockPC(pcId: string): Promise<IPC> {
    const pc = await PC.findById(pcId);
    if (!pc) {
      throw ApiError.notFound("PC not found");
    }

    // Find and end active session
    const activeSession = await GamingSession.findOne({
      pc: pcId,
      status: SessionStatus.ACTIVE,
    });

    if (activeSession) {
      // End the session
      const endTime = new Date();
      const durationMs = endTime.getTime() - activeSession.startTime.getTime();
      const durationMinutes = Math.ceil(durationMs / (1000 * 60));
      const durationHours = durationMinutes / 60;

      const costUsd = activeSession.hourlyRate.usd * durationHours;
      const costLbp = activeSession.hourlyRate.lbp * durationHours;

      activeSession.endTime = endTime;
      activeSession.duration = durationMinutes;
      activeSession.totalCost = {
        usd: Math.round(costUsd * 100) / 100,
        lbp: Math.round(costLbp),
      };
      activeSession.status = SessionStatus.COMPLETED;
      await activeSession.save();
    }

    // Update PC status
    pc.status = PCStatus.AVAILABLE;
    await pc.save();

    return pc;
  }

  private async generateSessionNumber(): Promise<string> {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    const lastSession = await GamingSession.findOne().sort({ createdAt: -1 });
    let sequence = 1;

    if (lastSession) {
      const lastSessionDate = lastSession.sessionNumber.substring(0, 8);
      const todayDate = `${year}${month}${day}`;

      if (lastSessionDate === todayDate) {
        const lastSequence = parseInt(
          lastSession.sessionNumber.substring(9),
          10
        );
        sequence = lastSequence + 1;
      }
    }

    return `${year}${month}${day}-${String(sequence).padStart(4, "0")}`;
  }
}

export default new PCService();

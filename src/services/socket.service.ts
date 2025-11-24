import { Server as SocketServer, Socket } from "socket.io";
import { Server as HTTPServer } from "http";
import logger from "../utils/logger";

interface PCData {
  socketId: string;
  status: "online" | "locked" | "unlocked" | "offline";
  lastSeen: Date;
}

interface PCRegistration {
  pcId: string;
  status: PCData["status"];
}

interface StatusUpdate {
  pcId: string;
  status: PCData["status"];
}

interface UnlockRequest {
  pcId: string;
}

class SocketService {
  private io: SocketServer | null = null;
  private connectedPCs = new Map<string, PCData>();

  initialize(httpServer: HTTPServer): void {
    this.io = new SocketServer(httpServer, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"],
      },
    });

    this.io.on("connection", (socket: Socket) => {
      logger.info(`Client connected: ${socket.id}`);

      socket.on("register", (data: PCRegistration) => {
        logger.info(`PC registered: ${data.pcId}`);
        this.connectedPCs.set(data.pcId, {
          socketId: socket.id,
          status: data.status,
          lastSeen: new Date(),
        });
        logger.info(`Total PCs connected: ${this.connectedPCs.size}`);
      });

      socket.on("statusUpdate", (data: StatusUpdate) => {
        const pc = this.connectedPCs.get(data.pcId);
        if (pc) {
          pc.status = data.status;
          pc.lastSeen = new Date();
          logger.info(`${data.pcId} status: ${data.status}`);
        }
      });

      socket.on("unlockRequest", (data: UnlockRequest) => {
        logger.info(`Unlock requested by ${data.pcId}`);
        socket.emit("unlock");
      });

      socket.on("disconnect", () => {
        logger.info(`Client disconnected: ${socket.id}`);

        for (const [pcId, data] of this.connectedPCs.entries()) {
          if (data.socketId === socket.id) {
            this.connectedPCs.delete(pcId);
            logger.info(`PC ${pcId} removed. Total: ${this.connectedPCs.size}`);
            break;
          }
        }
      });
    });

    logger.info("Socket.io initialized");
  }

  lockPC(pcId: string): boolean {
    const pc = this.connectedPCs.get(pcId);
    if (pc && this.io) {
      this.io.to(pc.socketId).emit("lock");
      logger.info(`LOCK command sent to ${pcId}`);
      return true;
    }
    logger.warn(`PC ${pcId} not found in connected PCs`);
    return false;
  }

  unlockPC(pcId: string): boolean {
    const pc = this.connectedPCs.get(pcId);
    if (pc && this.io) {
      this.io.to(pc.socketId).emit("unlock");
      logger.info(`UNLOCK command sent to ${pcId}`);
      return true;
    }
    logger.warn(`PC ${pcId} not found in connected PCs`);
    return false;
  }

  lockAllPCs(): number {
    let count = 0;
    if (this.io) {
      for (const [pcId, pc] of this.connectedPCs.entries()) {
        this.io.to(pc.socketId).emit("lock");
        count++;
      }
      logger.info(`LOCK ALL command sent to ${count} PCs`);
    }
    return count;
  }

  unlockAllPCs(): number {
    let count = 0;
    if (this.io) {
      for (const [pcId, pc] of this.connectedPCs.entries()) {
        this.io.to(pc.socketId).emit("unlock");
        count++;
      }
      logger.info(`UNLOCK ALL command sent to ${count} PCs`);
    }
    return count;
  }

  getConnectedPCs(): Array<{ pcId: string; status: string; lastSeen: Date }> {
    return Array.from(this.connectedPCs.entries()).map(([pcId, data]) => ({
      pcId,
      status: data.status,
      lastSeen: data.lastSeen,
    }));
  }

  getConnectedPCCount(): number {
    return this.connectedPCs.size;
  }
}

export default new SocketService();

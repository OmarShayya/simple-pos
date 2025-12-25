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

    logger.info("[SOCKET] ========================================");
    logger.info("[SOCKET] Socket.io server initializing...");
    logger.info("[SOCKET] ========================================");

    this.io.on("connection", (socket: Socket) => {
      logger.info("[SOCKET] ----------------------------------------");
      logger.info(`[SOCKET] NEW CONNECTION`);
      logger.info(`[SOCKET] Socket ID: ${socket.id}`);
      logger.info(`[SOCKET] Remote Address: ${socket.handshake.address}`);
      logger.info(`[SOCKET] Connected PCs before: ${this.connectedPCs.size}`);
      logger.info("[SOCKET] ----------------------------------------");

      socket.on("register", (data: PCRegistration) => {
        logger.info("[SOCKET] ========== PC REGISTRATION ==========");
        logger.info(`[SOCKET] PC ID: ${data.pcId}`);
        logger.info(`[SOCKET] Initial Status: ${data.status}`);
        logger.info(`[SOCKET] Socket ID: ${socket.id}`);

        this.connectedPCs.set(data.pcId, {
          socketId: socket.id,
          status: data.status,
          lastSeen: new Date(),
        });

        logger.info(`[SOCKET] Registration SUCCESS`);
        logger.info(`[SOCKET] Total PCs now connected: ${this.connectedPCs.size}`);
        logger.info(`[SOCKET] All connected PCs: ${JSON.stringify(Array.from(this.connectedPCs.keys()))}`);
        logger.info("[SOCKET] ======================================");
      });

      socket.on("statusUpdate", (data: StatusUpdate) => {
        logger.info("[SOCKET] ----- STATUS UPDATE -----");
        logger.info(`[SOCKET] PC ID: ${data.pcId}`);
        logger.info(`[SOCKET] New Status: ${data.status}`);

        const pc = this.connectedPCs.get(data.pcId);
        if (pc) {
          const oldStatus = pc.status;
          pc.status = data.status;
          pc.lastSeen = new Date();
          logger.info(`[SOCKET] Status changed: ${oldStatus} -> ${data.status}`);
        } else {
          logger.warn(`[SOCKET] PC ${data.pcId} not found in connected PCs!`);
        }
        logger.info("[SOCKET] ----------------------------");
      });

      socket.on("unlockRequest", (data: UnlockRequest) => {
        logger.info("[SOCKET] !!!!! UNLOCK REQUEST !!!!!");
        logger.info(`[SOCKET] Requested by PC: ${data.pcId}`);
        logger.info(`[SOCKET] Sending unlock event back...`);
        socket.emit("unlock");
        logger.info("[SOCKET] Unlock event sent");
        logger.info("[SOCKET] !!!!!!!!!!!!!!!!!!!!!!!!!!");
      });

      socket.on("disconnect", () => {
        logger.info("[SOCKET] ========== DISCONNECT ==========");
        logger.info(`[SOCKET] Socket ID: ${socket.id}`);

        let disconnectedPcId: string | null = null;
        for (const [pcId, data] of this.connectedPCs.entries()) {
          if (data.socketId === socket.id) {
            disconnectedPcId = pcId;
            this.connectedPCs.delete(pcId);
            break;
          }
        }

        if (disconnectedPcId) {
          logger.info(`[SOCKET] PC ${disconnectedPcId} disconnected and removed`);
        } else {
          logger.info(`[SOCKET] Unknown client disconnected (not a registered PC)`);
        }
        logger.info(`[SOCKET] Remaining PCs: ${this.connectedPCs.size}`);
        logger.info(`[SOCKET] Connected PCs: ${JSON.stringify(Array.from(this.connectedPCs.keys()))}`);
        logger.info("[SOCKET] ===================================");
      });
    });

    logger.info("[SOCKET] Socket.io server initialized and listening");
  }

  lockPC(pcId: string): boolean {
    logger.info("[SOCKET] ########## LOCK PC ##########");
    logger.info(`[SOCKET] Target PC ID: ${pcId}`);
    logger.info(`[SOCKET] Currently connected PCs: ${JSON.stringify(Array.from(this.connectedPCs.keys()))}`);

    const pc = this.connectedPCs.get(pcId);
    if (pc && this.io) {
      logger.info(`[SOCKET] PC found in connected list`);
      logger.info(`[SOCKET] Socket ID: ${pc.socketId}`);
      logger.info(`[SOCKET] Current status: ${pc.status}`);
      logger.info(`[SOCKET] Emitting 'lock' event...`);

      this.io.to(pc.socketId).emit("lock", { pcId, command: "lock", timestamp: new Date().toISOString() });

      logger.info(`[SOCKET] LOCK command SENT successfully to ${pcId}`);
      logger.info("[SOCKET] ##################################");
      return true;
    }

    logger.error(`[SOCKET] FAILED - PC ${pcId} NOT FOUND in connected PCs!`);
    logger.error(`[SOCKET] Available PCs: ${JSON.stringify(Array.from(this.connectedPCs.keys()))}`);
    logger.info("[SOCKET] ##################################");
    return false;
  }

  unlockPC(pcId: string): boolean {
    logger.info("[SOCKET] ########## UNLOCK PC ##########");
    logger.info(`[SOCKET] Target PC ID: ${pcId}`);
    logger.info(`[SOCKET] Currently connected PCs: ${JSON.stringify(Array.from(this.connectedPCs.keys()))}`);

    const pc = this.connectedPCs.get(pcId);
    if (pc && this.io) {
      logger.info(`[SOCKET] PC found in connected list`);
      logger.info(`[SOCKET] Socket ID: ${pc.socketId}`);
      logger.info(`[SOCKET] Current status: ${pc.status}`);
      logger.info(`[SOCKET] Emitting 'unlock' event...`);

      this.io.to(pc.socketId).emit("unlock", { pcId, command: "unlock", timestamp: new Date().toISOString() });

      logger.info(`[SOCKET] UNLOCK command SENT successfully to ${pcId}`);
      logger.info("[SOCKET] ####################################");
      return true;
    }

    logger.error(`[SOCKET] FAILED - PC ${pcId} NOT FOUND in connected PCs!`);
    logger.error(`[SOCKET] Available PCs: ${JSON.stringify(Array.from(this.connectedPCs.keys()))}`);
    logger.info("[SOCKET] ####################################");
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

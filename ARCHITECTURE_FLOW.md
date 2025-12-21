# Epic Lounge - Architecture & Flow Documentation

## Overview

Epic Lounge is a gaming cafe/internet lounge management system with two components:

1. **Server** - Central control server (REST API + WebSocket)
2. **Client** - Electron desktop app that locks/unlocks gaming PCs

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ADMIN / POS SYSTEM                          │
│              (makes REST API calls to control PCs)                  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTP REST API
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                           SERVER (server.ts)                        │
│                         Port 3000 (default)                         │
│                                                                     │
│  ┌─────────────────┐         ┌──────────────────────────────────┐  │
│  │   Express REST  │         │       Socket.io Server           │  │
│  │   API Endpoints │         │  (WebSocket real-time comms)     │  │
│  └─────────────────┘         └──────────────────────────────────┘  │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              connectedPCs Map<pcId, PCData>                  │   │
│  │  Stores: socketId, status, lastSeen for each connected PC   │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ Socket.io (WebSocket)
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          ▼                         ▼                         ▼
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  CLIENT PC-001   │    │  CLIENT PC-002   │    │  CLIENT PC-003   │
│  (Electron App)  │    │  (Electron App)  │    │  (Electron App)  │
│                  │    │                  │    │                  │
│  STARTS LOCKED!  │    │  STARTS LOCKED!  │    │  STARTS LOCKED!  │
└──────────────────┘    └──────────────────┘    └──────────────────┘
```

---

## CRITICAL: Initial State is LOCKED

When the client app starts, it **IMMEDIATELY LOCKS the PC**.

**Location:** `client/src/main.ts:752-754`

```typescript
startNormalOperation(): void {
  // ... setup code ...

  if (!this.isTestMode) {
    this.lockPC();  // <-- APP STARTS LOCKED!
  }
}
```

This is intentional for a gaming cafe - PCs should be unusable until a customer pays and the admin unlocks them.

---

## Server Socket Events

### Events the Server LISTENS for (from clients):

| Event | Payload | Description |
|-------|---------|-------------|
| `register` | `{ pcId: string, status: string }` | Client registers itself on connect |
| `statusUpdate` | `{ pcId: string, status: string }` | Client reports lock/unlock status change |
| `unlockRequest` | `{ pcId: string }` | Client requests to be unlocked (user pressed unlock button) |
| `disconnect` | - | Client disconnects, removed from Map |

### Events the Server EMITS (to clients):

| Event | Payload | Description |
|-------|---------|-------------|
| `lock` | - | Commands client to lock the PC |
| `unlock` | - | Commands client to unlock the PC |
| `timeUpdate` | `{ timeRemaining: number }` | Countdown timer update (seconds remaining) |

---

## Client Socket Events

### Events the Client LISTENS for (from server):

| Event | Handler | What it does |
|-------|---------|--------------|
| `lock` | `lockPC()` | Creates fullscreen lock window, blocks user input |
| `unlock` | `unlockPC()` | Destroys lock window, restores normal operation |
| `test-lock` | Lock then auto-unlock | Temporary lock for testing |
| `timeUpdate` | Update lock screen UI | Shows countdown timer on lock screen |

**Location:** `client/src/main.ts:582-604`

```typescript
this.socket.on("lock", () => {
  console.log("🔒 Lock command received from server");
  this.lockPC();
});

this.socket.on("unlock", () => {
  console.log("🔓 Unlock command received from server");
  this.unlockPC();
});

this.socket.on("timeUpdate", (data: { timeRemaining: number }) => {
  if (this.lockWindow && !this.lockWindow.isDestroyed()) {
    this.lockWindow.webContents.send("update-time", data.timeRemaining);
  }
});
```

### Events the Client EMITS (to server):

| Event | When | Payload |
|-------|------|---------|
| `register` | On connect | `{ pcId, status: "online", platform, safeMode }` |
| `statusUpdate` | After lock/unlock | `{ pcId, status: "locked" \| "unlocked" }` |
| `unlockRequest` | User requests unlock | `{ pcId }` |

---

## Complete Flow: Startup → Lock → Unlock

### 1. Client Startup Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     CLIENT STARTUP SEQUENCE                     │
└─────────────────────────────────────────────────────────────────┘

1. App launches
   └─► init() called
       └─► app.whenReady()

2. Check if first run
   ├─► YES: Show setup window (enter PC ID, server URL)
   └─► NO: startNormalOperation()

3. startNormalOperation():
   ├─► setupEmergencyUnlock()     // Register Ctrl+Escape / Cmd+Escape
   ├─► createMainWindow()          // Hidden control panel
   ├─► connectToServer()           // Connect to Socket.io server
   ├─► setupLocalControlServer()   // Local HTTP API on port 3001
   └─► lockPC()                    // ★ IMMEDIATELY LOCK THE PC ★

4. connectToServer():
   ├─► Create Socket.io connection
   ├─► On "connect": emit "register" event
   └─► Listen for "lock", "unlock", "timeUpdate" events
```

### 2. Server Receives Registration

```
┌─────────────────────────────────────────────────────────────────┐
│                  SERVER REGISTRATION HANDLING                   │
└─────────────────────────────────────────────────────────────────┘

1. Client connects → socket.id assigned

2. Client emits "register" { pcId: "PC-001", status: "online" }

3. Server stores in Map:
   connectedPCs.set("PC-001", {
     socketId: socket.id,
     status: "online",
     lastSeen: new Date()
   });

4. PC is now ready to receive commands
```

### 3. Admin Unlocks a PC (The Key Flow!)

```
┌─────────────────────────────────────────────────────────────────┐
│                      UNLOCK FLOW (CRITICAL)                     │
└─────────────────────────────────────────────────────────────────┘

STEP 1: Admin calls REST API
────────────────────────────
POST http://server:3000/api/unlock/PC-001

STEP 2: Server handles request (server.ts:134-154)
──────────────────────────────────────────────────
app.post('/api/unlock/:pcId', (req, res) => {
  const pcId = req.params.pcId;
  const pc = connectedPCs.get(pcId);  // Find PC in Map

  if (pc) {
    io.to(pc.socketId).emit('unlock');  // ★ EMIT UNLOCK TO CLIENT ★
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false });
  }
});

STEP 3: Client receives "unlock" event (main.ts:587-589)
────────────────────────────────────────────────────────
this.socket.on("unlock", () => {
  console.log("🔓 Unlock command received from server");
  this.unlockPC();  // ★ CLOSE LOCK WINDOW ★
});

STEP 4: unlockPC() executes (main.ts:416-554)
─────────────────────────────────────────────
- Resets unlock attempts counter
- Restores system state (dock, menu, shortcuts)
- Closes the lock window
- Shows the main control panel
- Emits "statusUpdate" { status: "unlocked" } to server
```

### 4. Admin Locks a PC

```
┌─────────────────────────────────────────────────────────────────┐
│                        LOCK FLOW                                │
└─────────────────────────────────────────────────────────────────┘

STEP 1: Admin calls REST API
────────────────────────────
POST http://server:3000/api/lock/PC-001

STEP 2: Server handles request (server.ts:111-131)
──────────────────────────────────────────────────
app.post('/api/lock/:pcId', (req, res) => {
  const pc = connectedPCs.get(pcId);
  if (pc) {
    io.to(pc.socketId).emit('lock');  // ★ EMIT LOCK TO CLIENT ★
  }
});

STEP 3: Client receives "lock" event (main.ts:582-585)
──────────────────────────────────────────────────────
this.socket.on("lock", () => {
  this.lockPC();
});

STEP 4: lockPC() executes (main.ts:398-414)
───────────────────────────────────────────
- Hides main window
- Creates fullscreen lock window (kiosk mode)
- Blocks keyboard shortcuts
- Emits "statusUpdate" { status: "locked" } to server
```

---

## Server REST API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/pcs` | List all connected PCs |
| POST | `/api/lock/:pcId` | Lock specific PC |
| POST | `/api/unlock/:pcId` | Unlock specific PC |
| POST | `/api/lock-all` | Lock all connected PCs |
| POST | `/api/unlock-all` | Unlock all connected PCs |
| POST | `/api/timer/:pcId` | Set session timer (body: `{ seconds: number }`) |
| GET | `/health` | Server health check |

---

## Timer Feature Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                       TIMER FLOW                                │
└─────────────────────────────────────────────────────────────────┘

1. Admin sets timer:
   POST /api/timer/PC-001  { seconds: 3600 }  // 1 hour

2. Server starts interval (server.ts:195-204):
   const interval = setInterval(() => {
     timeRemaining--;
     io.to(pc.socketId).emit('timeUpdate', { timeRemaining });

     if (timeRemaining <= 0) {
       clearInterval(interval);
       io.to(pc.socketId).emit('lock');  // Auto-lock when time expires
     }
   }, 1000);

3. Client receives "timeUpdate" every second:
   - Updates lock screen UI with countdown
   - When time = 0, receives "lock" event
```

---

## Status Values

| Status | Meaning |
|--------|---------|
| `online` | PC connected but not in specific state |
| `locked` | PC is locked (lock screen visible) |
| `unlocked` | PC is unlocked (user can use it) |
| `offline` | PC disconnected |

---

## Key Implementation Points for Your Server

### 1. Store socket IDs properly

```typescript
// When client registers
connectedPCs.set(data.pcId, {
  socketId: socket.id,  // CRITICAL: Need this to send commands
  status: data.status,
  lastSeen: new Date()
});
```

### 2. Emit to specific client using socketId

```typescript
// To unlock a specific PC
const pc = connectedPCs.get(pcId);
if (pc) {
  io.to(pc.socketId).emit('unlock');  // Socket.io room targeting
}
```

### 3. Handle disconnect cleanup

```typescript
socket.on('disconnect', () => {
  // Find and remove the PC from your Map
  for (const [pcId, data] of connectedPCs.entries()) {
    if (data.socketId === socket.id) {
      connectedPCs.delete(pcId);
      break;
    }
  }
});
```

### 4. The client expects these exact event names:

- `lock` - No payload needed
- `unlock` - No payload needed
- `timeUpdate` - Payload: `{ timeRemaining: number }`

---

## Summary

1. **Client starts LOCKED** - This is by design
2. **Client connects to server** via Socket.io and registers itself
3. **Server stores client's socketId** in a Map for targeting
4. **Admin controls via REST API** → Server emits socket events → Client responds
5. **Simple event names**: `lock`, `unlock`, `timeUpdate`
6. **Client updates server** with `statusUpdate` after state changes

---

*Generated: December 21, 2025*

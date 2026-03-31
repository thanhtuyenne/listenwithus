import { Server } from "socket.io";
import { NextApiResponse } from "next";
import { IncomingMessage, Server as HttpServer } from "http";
import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import { getFirestore, Firestore, doc, setDoc, getDoc } from "firebase/firestore";

type NextApiResponseWithSocket = NextApiResponse & {
  socket: {
    server: HttpServer & {
      io?: Server;
    };
  };
};

const firebaseConfig = {
  apiKey: "AIzaSyA2kFgAn4z-PnpopURdWe2swuR6noAFXIA",
  authDomain: "listenwithus-c9ee5.firebaseapp.com",
  projectId: "listenwithus-c9ee5",
  storageBucket: "listenwithus-c9ee5.firebasestorage.app",
  messagingSenderId: "572442301449",
  appId: "1:572442301449:web:dbb0dd4e3c37acfca214d8",
};
const firebaseApp: FirebaseApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db: Firestore = getFirestore(firebaseApp);

interface RoomState {
  commitId: string;
  videoId: string | null;
  timestamp: number;
  isPlaying: boolean;
  lastUpdate: number;
  hostUserId: string | null;
}

interface ActionPayload {
  roomId: string;
  userId: string;
  lastKnownCommit: string;
  action: {
    type: "PLAY" | "PAUSE" | "SEEK" | "LOAD_VIDEO";
    videoId?: string;
    timestamp: number;
  };
}

// roomId → RoomState
const rooms = new Map<string, RoomState>();
// roomId → Set of socketIds
const roomSockets = new Map<string, Set<string>>();
// socketId → userId (for host tracking across reconnects)
const socketToUser = new Map<string, string>();
// roomId → Set of userIds currently in room
const roomUsers = new Map<string, Set<string>>();
// Debounce timers for Firestore flush
const firestoreFlushTimers = new Map<string, ReturnType<typeof setTimeout>>();
// Per-room broadcast cooldown (push flood prevention)
const roomPushCooldown = new Map<string, number>();
// Per-room periodic sync broadcast interval
const roomSyncIntervals = new Map<string, ReturnType<typeof setInterval>>();

const CONFLICT_WINDOW_MS = 400;

function startSyncBroadcast(roomId: string, io: Server) {
  if (roomSyncIntervals.has(roomId)) return;
  const timer = setInterval(() => {
    const room = rooms.get(roomId);
    if (!room) { clearInterval(timer); roomSyncIntervals.delete(roomId); return; }
    if (!room.isPlaying) return;
    const now = Date.now();
    const referenceTime = room.timestamp + (now - room.lastUpdate) / 1000;
    io.to(roomId).emit("sync", { referenceTime, serverTime: now });
  }, 3000);
  roomSyncIntervals.set(roomId, timer);
}

function createGUID(): string {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  arr[6] = (arr[6] & 0x0f) | 0x40;
  arr[8] = (arr[8] & 0x3f) | 0x80;
  return arr.reduce((str, byte, i) => {
    const hex = byte.toString(16).padStart(2, "0");
    return str + ([4, 6, 8, 10].includes(i) ? "-" : "") + hex;
  }, "");
}

function applyAction(room: RoomState, action: ActionPayload["action"]): void {
  switch (action.type) {
    case "PLAY":
      room.isPlaying = true;
      room.timestamp = action.timestamp;
      break;
    case "PAUSE":
      room.isPlaying = false;
      room.timestamp = action.timestamp;
      break;
    case "SEEK":
      room.timestamp = action.timestamp;
      break;
    case "LOAD_VIDEO":
      room.videoId = action.videoId ?? room.videoId;
      room.timestamp = 0;
      room.isPlaying = true;
      break;
  }
  room.lastUpdate = Date.now();
  room.commitId = createGUID();
}

function buildCommitBroadcast(room: RoomState, conflictResolved: boolean) {
  return {
    commitId: room.commitId,
    videoId: room.videoId,
    timestamp: room.timestamp,
    isPlaying: room.isPlaying,
    serverTime: Date.now(),
    hostUserId: room.hostUserId,
    conflictResolved,
  };
}

function cleanupSocketFromRoom(socketId: string, roomId: string, io: Server) {
  const members = roomSockets.get(roomId);
  if (members) {
    members.delete(socketId);
    if (members.size === 0) {
      rooms.delete(roomId);
      roomSockets.delete(roomId);
      roomUsers.delete(roomId);
      roomPushCooldown.delete(roomId);
      const syncTimer = roomSyncIntervals.get(roomId);
      if (syncTimer) { clearInterval(syncTimer); roomSyncIntervals.delete(roomId); }
      return;
    }
  }

  const room = rooms.get(roomId);
  if (!room) return;

  const userId = socketToUser.get(socketId);
  if (userId) {
    const users = roomUsers.get(roomId);
    // Only remove userId if no other socket in room uses it
    const userStillPresent = [...(members ?? [])].some(
      (sid) => socketToUser.get(sid) === userId
    );
    if (!userStillPresent) users?.delete(userId);

    // If host left, assign next member as host
    if (room.hostUserId === userId && !userStillPresent) {
      const nextUserId = getNextUserId(roomId, socketId);
      room.hostUserId = nextUserId;
      io.to(roomId).emit("hostChanged", { hostUserId: nextUserId });
    }
  }
}

function getNextUserId(roomId: string, excludeSocketId: string): string | null {
  const members = roomSockets.get(roomId);
  if (!members) return null;
  for (const sid of members) {
    if (sid !== excludeSocketId) return socketToUser.get(sid) ?? null;
  }
  return null;
}

function flushRoomToFirestore(roomId: string, room: RoomState) {
  const existing = firestoreFlushTimers.get(roomId);
  if (existing) clearTimeout(existing);
  firestoreFlushTimers.set(roomId, setTimeout(async () => {
    try {
      await setDoc(doc(db, "socketRooms", roomId), {
        commitId: room.commitId,
        videoId: room.videoId,
        timestamp: room.timestamp,
        isPlaying: room.isPlaying,
        lastUpdate: room.lastUpdate,
        hostUserId: room.hostUserId,
      }, { merge: true });
    } catch (e) {
      console.error("Firestore flush failed", e);
    }
    firestoreFlushTimers.delete(roomId);
  }, 2000));
}

export default function handler(req: IncomingMessage, res: NextApiResponseWithSocket) {
  if (!res.socket) {
    console.error("Socket is not available");
    return res?.status(200).end();
  }

  if (!res.socket.server.io) {
    console.log("Initializing Socket.io server...");

    const io = new Server(res.socket.server, {
      cors: { origin: "*" },
    });

    res.socket.server.io = io;

    io.on("connection", (socket) => {

      socket.on("joinRoom", async ({ roomId, userId }: { roomId: string; userId: string }) => {
        socket.join(roomId);

        // Track socket → user mapping
        socketToUser.set(socket.id, userId);

        let members = roomSockets.get(roomId);
        if (!members) { members = new Set(); roomSockets.set(roomId, members); }
        members.add(socket.id);

        let users = roomUsers.get(roomId);
        if (!users) { users = new Set(); roomUsers.set(roomId, users); }
        users.add(userId);

        let room = rooms.get(roomId);

        // Cold-start: restore from Firestore if room not in memory
        if (!room) {
          try {
            const snap = await getDoc(doc(db, "socketRooms", roomId));
            if (snap.exists()) {
              room = snap.data() as RoomState;
              rooms.set(roomId, room);
            }
          } catch (e) {
            console.error("Firestore restore failed", e);
          }
        }

        if (!room) {
          room = {
            commitId: createGUID(),
            videoId: null,
            timestamp: 0,
            isPlaying: false,
            lastUpdate: Date.now(),
            hostUserId: userId, // first joiner is host
          };
          rooms.set(roomId, room);
        } else if (!room.hostUserId) {
          // Room exists but has no host (all left) → assign this user
          room.hostUserId = userId;
          io.to(roomId).emit("hostChanged", { hostUserId: userId });
        } else if (room.hostUserId === userId) {
          // Host reconnected — notify room
          io.to(roomId).emit("hostChanged", { hostUserId: userId });
        }

        // Send current HEAD to joining client
        socket.emit("commit", buildCommitBroadcast(room, false));
      });

      socket.on("action", (data: ActionPayload) => {
        const room = rooms.get(data.roomId);
        if (!room) return;

        console.log("action", data.action.type, "from", data.userId);

        const isHostAction = data.userId === room.hostUserId;
        const isFastForward = data.lastKnownCommit === room.commitId;
        const now = Date.now();
        const withinConflictWindow = (now - room.lastUpdate) <= CONFLICT_WINDOW_MS;

        if (isFastForward) {
          // No conflict — apply and broadcast to all
          applyAction(room, data.action);
          flushRoomToFirestore(data.roomId, room);
          if (room.isPlaying) startSyncBroadcast(data.roomId, io);

          if (now - (roomPushCooldown.get(data.roomId) ?? 0) >= 400) {
            io.to(data.roomId).emit("commit", buildCommitBroadcast(room, false));
            roomPushCooldown.set(data.roomId, now);
          }
        } else if (withinConflictWindow) {
          if (isHostAction) {
            // Host wins conflict — apply and broadcast to all
            applyAction(room, data.action);
            flushRoomToFirestore(data.roomId, room);
            if (room.isPlaying) startSyncBroadcast(data.roomId, io);
            io.to(data.roomId).emit("commit", buildCommitBroadcast(room, true));
            roomPushCooldown.set(data.roomId, now);
          } else {
            // Non-host loses conflict — send current HEAD back to them only
            socket.emit("commit", buildCommitBroadcast(room, true));
          }
        } else {
          // Stale client (> conflict window) — send current HEAD to resync
          socket.emit("commit", buildCommitBroadcast(room, true));
        }
      });

      socket.on("heartbeat", ({ roomId, timestamp }: { roomId: string; timestamp: number }) => {
        const room = rooms.get(roomId);
        if (!room || !room.isPlaying) return;
        // Only advance — furthest-ahead client wins
        if (timestamp > room.timestamp) {
          room.timestamp = timestamp;
          room.lastUpdate = Date.now();
        }
      });

      socket.on("transferHost", ({ roomId, userId, targetUserId }: {
        roomId: string;
        userId: string;
        targetUserId: string;
      }) => {
        const room = rooms.get(roomId);
        if (!room || room.hostUserId !== userId) return;
        room.hostUserId = targetUserId;
        io.to(roomId).emit("hostChanged", { hostUserId: targetUserId });
        flushRoomToFirestore(roomId, room);
      });

      socket.on("fetch", async (roomId: string) => {
        const room = rooms.get(roomId);
        if (room && room.videoId) {
          const now = Date.now();
          const compensatedTimestamp =
            room.timestamp + (room.isPlaying ? (now - room.lastUpdate) / 1000 : 0);
          socket.emit("commit", {
            ...buildCommitBroadcast(room, false),
            timestamp: compensatedTimestamp,
            serverTime: now,
          });
        }
      });

      socket.on("leaveRoom", (roomId: string) => {
        socket.leave(roomId);
        cleanupSocketFromRoom(socket.id, roomId, io);
      });

      socket.on("disconnect", () => {
        console.log("Client disconnected:", socket.id);
        // socket.rooms includes the socket's own ID — roomSockets only has explicit rooms
        socket.rooms.forEach((roomId) => {
          cleanupSocketFromRoom(socket.id, roomId, io);
        });
        socketToUser.delete(socket.id);
      });
    });
  }

  res.end();
}

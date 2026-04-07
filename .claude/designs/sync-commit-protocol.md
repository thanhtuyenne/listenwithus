# Sync Protocol: Optimistic Commit + Host Manager

## Understanding Summary

- **What:** Git-flow inspired video sync — each state change has a `commitId` (HEAD), clients send `lastKnownCommit` with every action, server detects divergence and arbitrates
- **Why:** Current protocol has no conflict detection — simultaneous actions produce inconsistent state across clients
- **Who:** Rooms of 10+ users, anyone can control playback, host is tie-breaker
- **Constraints:** No deep history needed (HEAD only), userId from localStorage, silent rewind on conflict
- **Non-goals:** No replay history, no real authentication, no permission restrictions on non-host

---

## Assumptions

- `userId` generated once, stored in `localStorage` as `lwu_userId`, stable across refresh
- Host = first socket to join the room (stored in room state + Firestore)
- When host disconnects → next remaining member becomes host
- When old host reconnects → they are a regular member (no auto-restore)
- Conflict window = 400ms (two actions within 400ms = conflict)
- Server remains single source of truth

---

## Data Structures

### Server RoomState
```typescript
interface RoomState {
  commitId: string        // HEAD — GUID of latest commit
  videoId: string | null
  timestamp: number
  isPlaying: boolean
  lastUpdate: number
  hostUserId: string | null
}
```

### Client → Server: `action` event
```typescript
interface ActionPayload {
  roomId: string
  userId: string          // from localStorage
  lastKnownCommit: string // commit ID client currently knows
  action: {
    type: "PLAY" | "PAUSE" | "SEEK" | "LOAD_VIDEO"
    videoId?: string      // only for LOAD_VIDEO
    timestamp: number
  }
}
```

### Client → Server: `joinRoom` event
```typescript
interface JoinRoomPayload {
  roomId: string
  userId: string
}
```

### Server → Client: `commit` event (replaces `pullrq`)
```typescript
interface CommitBroadcast {
  commitId: string
  videoId: string
  timestamp: number
  isPlaying: boolean
  serverTime: number        // for latency compensation
  hostUserId: string | null
  conflictResolved: boolean // true → client must silent rewind
}
```

### Server → Client: `hostChanged` event
```typescript
interface HostChangedPayload {
  hostUserId: string | null
}
```

---

## Server Arbitration Logic

### Fast-forward (no conflict)
```
client.lastKnownCommit === room.commitId
→ apply action
→ generate new commitId
→ broadcast commit to ALL (io.to)
→ conflictResolved: false
```

### Conflict resolution
```
client.lastKnownCommit !== room.commitId
→ within 400ms conflict window?
    YES:
      if action.userId === room.hostUserId:
        apply action (host wins)
        broadcast to ALL, conflictResolved: true for non-host
      else:
        reject — send current HEAD back to conflicting client only
        conflictResolved: true
    NO (> 400ms → stale client):
      send current HEAD to that client only
      conflictResolved: true
```

### Action → State translation
```
PLAY:       isPlaying = true,  timestamp = action.timestamp
PAUSE:      isPlaying = false, timestamp = action.timestamp
SEEK:       timestamp = action.timestamp (isPlaying unchanged)
LOAD_VIDEO: videoId = action.videoId, timestamp = 0, isPlaying = true
```

---

## Host Manager

### Assignment
- First `joinRoom` to a room → that userId becomes host
- Stored in `room.hostUserId` + Firestore room document
- On join: if `room.hostUserId === userId` → restore (broadcast `hostChanged`)
- On join: if `room.hostUserId === null` → assign this user as host

### Transfer
```
socket.emit("transferHost", { roomId, userId, targetUserId })
// Server: only current host can transfer
room.hostUserId = targetUserId
io.to(roomId).emit("hostChanged", { hostUserId: targetUserId })
```

### Disconnect
```
if disconnected socket's userId === room.hostUserId:
  nextHost = first remaining member in roomSockets
  room.hostUserId = nextHost?.userId ?? null
  io.to(roomId).emit("hostChanged", { hostUserId: room.hostUserId })
```

---

## Client-Side Logic

### Initialization
```typescript
// Stable userId across sessions
function getUserId(): string {
  let id = localStorage.getItem("lwu_userId");
  if (!id) { id = generateGUID(); localStorage.setItem("lwu_userId", id); }
  return id;
}

// New refs/state needed
const lastKnownCommitRef = useRef<string | null>(null);
const userId = getUserId(); // stable, computed once
const [isHost, setIsHost] = useState(false);
const [hostUserId, setHostUserId] = useState<string | null>(null);
```

### Sending actions (replaces `emitVideoState`)
```typescript
function commitAction(type: ActionType, timestamp: number, videoId?: string) {
  const roomId = currentRoomRef.current;
  if (!roomId || !lastKnownCommitRef.current) return;
  socket.emit("action", {
    roomId, userId,
    lastKnownCommit: lastKnownCommitRef.current,
    action: { type, timestamp, videoId }
  });
}
```

### Receiving commits (replaces `pull()`)
```typescript
function applyCommit(data: CommitBroadcast, player: any) {
  if (!player) return;
  lastKnownCommitRef.current = data.commitId; // always update HEAD
  setHostUserId(data.hostUserId);
  setIsHost(data.hostUserId === userId);

  isPulling.current = true;
  const networkDelay = data.isPlaying ? (Date.now() - data.serverTime) / 2 : 0;
  const compensatedTimestamp = data.timestamp + networkDelay / 1000;

  if (data.videoId && data.videoId !== player.getVideoData()?.video_id) {
    player.loadVideoById(data.videoId, compensatedTimestamp);
  } else if (player.getVideoData()?.video_id) {
    const drift = player.getCurrentTime() - compensatedTimestamp;
    const forceSeek = data.conflictResolved || drift > 1 || drift < -1;
    if (forceSeek) player.seekTo(compensatedTimestamp);
  }

  if (player.getVideoData()?.video_id) {
    const isPlaying = player.getPlayerState() === YT.PlayerState.PLAYING;
    if (data.isPlaying !== isPlaying) {
      data.isPlaying ? player.playVideo() : player.pauseVideo();
    }
  }

  setTimeout(() => { isPulling.current = false; }, 500);
}
```

### handlePlayerStateChange mapping
```typescript
PLAYING  → commitAction("PLAY", player.getCurrentTime())
PAUSED   → commitAction("PAUSE", player.getCurrentTime())
// SEEK is handled by loadVideo UI, not onStateChange
```

---

## Event Protocol (Full)

| Event | Direction | Replaces |
|-------|-----------|---------|
| `joinRoom({ roomId, userId })` | C→S | `joinRoom(roomId)` |
| `action(ActionPayload)` | C→S | `push(data)` |
| `fetch(roomId)` | C→S | unchanged |
| `transferHost({ roomId, userId, targetUserId })` | C→S | new |
| `leaveRoom(roomId)` | C→S | unchanged |
| `commit(CommitBroadcast)` | S→C | `pullrq` |
| `hostChanged({ hostUserId })` | S→C | new |

---

## Edge Cases

| Case | Handling |
|------|---------|
| Client joins with no HEAD | `joinRoom` response always includes current commit → set `lastKnownCommit` before any action |
| Rapid seek drag | Client debounce: only emit on `PLAYING`/`PAUSED` state change, not during drag |
| Old host reconnects | Treated as regular member — new host must transfer manually |
| Room has 1 person | That person is host, no conflicts possible |
| All members leave | `room.hostUserId = null`, room cleaned up from memory |

---

## Decision Log

| # | Decision | Alternatives | Reason |
|---|----------|--------------|--------|
| 1 | Optimistic commit + server arbitration | Server queue, Vector clock | Fast UX, clear conflict model, minimal complexity |
| 2 | `lastKnownCommit` GUID to detect conflict | Integer version counter | Easier to debug, no global counter needed |
| 3 | Host = tie-breaker only | Full control lock, permission system | Anyone can still act — more natural UX |
| 4 | Host = first joiner | Creator from Firestore | Simple, no extra room creation flow |
| 5 | userId from localStorage + socket mapping | Full auth, session cookie | Persists across refresh, no login required |
| 6 | Host disconnect → assign next member | Keep host slot empty | Room never has no authority |
| 7 | Old host reconnect does NOT auto-restore | Auto-restore | Avoids conflict with current host |
| 8 | `action.type` enum vs raw state | Send isPlaying/timestamp directly | Server understands intent → better arbitration |
| 9 | Silent rewind on conflict | Toast, visual indicator | No UX noise |
| 10 | Conflict window = 400ms | 200ms, 1000ms | Catches simultaneous actions without being too broad |

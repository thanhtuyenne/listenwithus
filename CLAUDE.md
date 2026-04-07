# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server with Turbopack on http://localhost:3000
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Run ESLint via next lint
```

No test runner is configured.

## Architecture

**ListenWithUs** is a YouTube watch-party app — multiple users in a "room" watch the same YouTube video in sync.

### Tech stack
- **Next.js 15** (App Router + Pages Router coexist — see below)
- **Socket.io** for real-time video state sync
- **Firebase Firestore** for room persistence
- **YouTube IFrame API** (loaded dynamically via `<script>` tag at runtime)
- **Tailwind CSS**
- Path alias: `@/*` → `src/*`

### Dual-router situation
The codebase has two routing systems active simultaneously:

| Path | Router | Status |
|---|---|---|
| `src/pages/room/[id].tsx` | Pages Router | **Active** — the real room page with full sync logic |
| `src/app/[id]/page.tsx` | App Router | Experimental / older version using `RoomContext` |
| `src/pages/create-room.tsx` | Pages Router | Create a room via Firestore |
| `src/pages/join-room.tsx` | Pages Router | Navigate to a room by code |

The Pages Router room page (`src/pages/room/[id].tsx`) is the primary implementation. The App Router version under `src/app/[id]/` wraps children in `RoomProvider` and uses a separate `YouTubeIframeManager` component, but has incomplete sync logic.

### Socket.io protocol
The server (`src/pages/api/socket.ts`) is initialized lazily on first HTTP request and maintains in-memory room state via a `Map`. Clients use three events:

- **`joinRoom(roomId)`** — join a socket room; server creates room state if absent
- **`push(data)`** — broadcast video state `{ roomId, videoId, timestamp, isPlaying }` to others via `pullrq`
- **`fetch(roomId)`** — request current room state from server; server responds with `pullrq` including time-adjusted timestamp
- **`pullrq(data)`** — received by clients; triggers seek/play/pause to sync the player

The client socket singleton lives in `src/app/lib/socket-room.ts` and is imported wherever needed.

### Room sync logic (Pages Router)
In `src/pages/room/[id].tsx`:
- On player ready: emits `fetch` to get current room state
- On `PAUSED` state change: emits `push` with `isPlaying: false`
- On `PLAYING` state change: emits `fetch` to re-sync before playing
- Interval (3s): if playing and last update was >3s ago, emits `push` to keep others in sync
- `pull()`: applies incoming state — loads video if different, seeks if drift >2s, syncs play/pause

### Firebase
`src/app/lib/firebase.ts` exports `db` (Firestore instance). Used only in `create-room.tsx` to create room documents in the `rooms` collection. The firebase config (including API key) is hardcoded in this file — it's a public web API key for Firebase, but be cautious about committing changes that expand its usage.

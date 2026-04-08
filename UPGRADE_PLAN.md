# ListenWithUs — Upgrade Plan

> Tài liệu kế hoạch nâng cấp UX/UI toàn diện.  
> Đọc từ trên xuống, thực hiện theo thứ tự Phase.

---

## Mục lục

1. [Tổng quan kiến trúc hiện tại](#1-tổng-quan-kiến-trúc-hiện-tại)
2. [Cấu trúc thư mục mục tiêu](#2-cấu-trúc-thư-mục-mục-tiêu)
3. [Context & Utilities sẵn có — cách dùng](#3-context--utilities-sẵn-có--cách-dùng)
4. [Phase 1 — Foundation](#phase-1--foundation)
5. [Phase 2 — Landing & Entry Flow](#phase-2--landing--entry-flow)
6. [Phase 3 — Room Page UI Polish](#phase-3--room-page-ui-polish)
7. [Phase 4 — Features mới](#phase-4--features-mới)
8. [Checklist tổng](#checklist-tổng)

---

## 1. Tổng quan kiến trúc hiện tại

```
src/
├── pages/                        ← Pages Router (ĐANG HOẠT ĐỘNG)
│   ├── create-room.tsx           ✗ Bare UI, chỉ có 1 button
│   ├── join-room.tsx             ✗ Bare UI, chỉ có input
│   ├── room/[id].tsx             ✔ Logic đầy đủ, UI cần polish
│   └── api/
│       └── socket.ts             ✔ Sync protocol ổn định
│
└── app/                          ← App Router (EXPERIMENTAL, chưa dùng thực tế)
    ├── globals.css               △ Thiếu dark bg mặc định
    ├── layout.tsx                ✔ Root layout
    ├── [id]/
    │   ├── layout.tsx            △ Có RoomProvider, UI placeholder
    │   └── page.tsx              △ Demo cũ, chưa có sync
    ├── context/
    │   └── RoomContext.tsx       ✔ Có thể reuse cho Pages Router
    ├── types/
    │   └── Room.ts               ✔ Type định nghĩa tốt
    └── lib/
        ├── firebase.ts           ✔ Đã fix duplicate-app
        ├── socket-room.ts        ✔ Singleton socket
        └── components/
            └── YouTubeIframeManager.tsx  △ Giữ làm reference
```

### Vấn đề hiện tại

| File | Vấn đề |
|------|--------|
| `create-room.tsx` | Không có branding, không có join flow |
| `join-room.tsx` | Không cần thiết (sẽ merge vào landing) |
| `room/[id].tsx` | Monolithic ~700 dòng, không responsive, không có empty state, không có share |
| `globals.css` | Body background trắng, chưa force dark |
| Không có `_app.tsx` | CSS không được import vào Pages Router |
| Không có `src/components/` | Không có component tái sử dụng |

---

## 2. Cấu trúc thư mục mục tiêu

```
src/
│
├── pages/                              ← Pages Router
│   ├── _app.tsx                        [TẠO MỚI] Import globals.css
│   ├── index.tsx                       [TẠO MỚI] Landing page
│   ├── create-room.tsx                 [XÓA] Logic chuyển vào index.tsx
│   ├── join-room.tsx                   [GIỮ] Redirect sang index.tsx
│   ├── room/
│   │   └── [id].tsx                    [REFACTOR] Dùng components tách ra
│   └── api/
│       └── socket.ts                   [KHÔNG ĐỘNG VÀO]
│
├── app/                                ← App Router (giữ nguyên)
│   ├── globals.css                     [SỬA] Force dark bg
│   ├── layout.tsx                      [GIỮ]
│   ├── context/
│   │   └── RoomContext.tsx             [GIỮ + MỞ RỘNG]
│   ├── types/
│   │   ├── Room.ts                     [GIỮ]
│   │   └── Socket.ts                   [TẠO MỚI] Types cho socket events
│   └── lib/
│       ├── firebase.ts                 [GIỮ]
│       ├── socket-room.ts              [GIỮ]
│       └── hooks/                      [TẠO MỚI] Custom hooks
│           ├── useSocket.ts
│           ├── useNickname.ts
│           └── useRoom.ts              (wrapper của RoomContext)
│
└── components/                         [TẠO MỚI] Thư mục chính
    │
    ├── ui/                             [TẠO MỚI] Primitive components
    │   ├── Button.tsx
    │   ├── Input.tsx
    │   ├── Modal.tsx
    │   ├── Pill.tsx
    │   └── Toast.tsx
    │
    ├── room/                           [TẠO MỚI] Room-specific components
    │   ├── Navbar.tsx                  Topbar với status pills
    │   ├── VideoPlayer.tsx             YouTube player wrapper
    │   ├── ControlsBar.tsx             URL input + Load + Sync
    │   ├── EmojiBar.tsx                Emoji reactions bar
    │   ├── ChatPanel.tsx               Slide-in chat panel
    │   ├── NicknameModal.tsx           Entry modal
    │   ├── ShareModal.tsx              Share room modal
    │   └── EmptyState.tsx              No-video placeholder
    │
    └── layout/
        └── PageWrapper.tsx             Dark bg wrapper
```

---

## 3. Context & Utilities sẵn có — cách dùng

### 3.1 `src/app/lib/socket-room.ts` — Socket singleton

```typescript
// Cách import (đã dùng trong room/[id].tsx)
import socket from "@/app/lib/socket-room";

// Socket đang dùng autoConnect: false
// → Phải gọi connect() SAU KHI server sẵn sàng:
window.fetch("/api/socket").finally(() => {
  if (!socket.connected) socket.connect();
});

// Events hiện có (server socket.ts):
socket.emit("joinRoom",    { roomId, userId });
socket.emit("action",      { roomId, userId, lastKnownCommit, action });
socket.emit("heartbeat",   { roomId, timestamp });
socket.emit("chatMessage", { roomId, nickname, message });
socket.emit("emojiReaction",{ roomId, nickname, emoji });
socket.emit("fetch",       roomId);
socket.emit("leaveRoom",   roomId);
socket.emit("transferHost",{ roomId, userId, targetUserId });

socket.on("commit",        (data: CommitBroadcast) => {});
socket.on("sync",          ({ referenceTime, serverTime }) => {});
socket.on("chatMessage",   ({ nickname, message, timestamp }) => {});
socket.on("emojiReaction", ({ nickname, emoji }) => {});
socket.on("hostChanged",   ({ hostUserId }) => {});
```

### 3.2 `src/app/lib/firebase.ts` — Firestore

```typescript
// Import
import { db } from "@/app/lib/firebase";
import { collection, addDoc, getDoc, doc } from "firebase/firestore";

// TẠO PHÒNG (đang dùng trong create-room.tsx)
const roomRef = await addDoc(collection(db, "rooms"), {
  code: Math.random().toString(36).substring(7),
  videoId: "",
  queue: [],
});
// → roomRef.id là roomId để navigate: /room/${roomRef.id}

// LẤY PHÒNG
const snap = await getDoc(doc(db, "rooms", roomId));
if (snap.exists()) { const data = snap.data(); }

// SOCKET STATE (server tự flush, client không cần ghi trực tiếp)
// Firestore collection "socketRooms" được server dùng làm backup.
// Client chỉ dùng collection "rooms" (metadata phòng).
```

### 3.3 `src/app/context/RoomContext.tsx` — Room state

```typescript
// Context này đang dùng trong App Router ([id]/layout.tsx)
// Có thể wrap vào Pages Router bằng cách dùng trong _app.tsx
// hoặc wrap riêng trong room/[id].tsx

import { useRoom } from "@/app/context/RoomContext";
const { room, updateRoomData } = useRoom();

// Room type (src/app/types/Room.ts):
interface Room {
  id: string;
  name: string;
  host: string;           // userId của host
  participants: string[]; // array userIds
  videoQueue: string[];   // playlist
  currentVideo: string | null;
  playbackState: "playing" | "paused";
  timestamp: number;
}

// Cập nhật một phần:
updateRoomData({ currentVideo: "dQw4w9WgXcQ", playbackState: "playing" });
```

### 3.4 `src/pages/room/[id].tsx` — Các hàm & logic quan trọng

```typescript
// ── Tạo userId bền vững (localStorage)
function getUserId(): string {
  let id = localStorage.getItem("lwu_userId");
  if (!id) { id = generateId(); localStorage.setItem("lwu_userId", id); }
  return id;
}

// ── Gửi action lên server (PLAY/PAUSE/SEEK/LOAD_VIDEO)
function commitAction(type: ActionType, timestamp: number, videoId?: string) {
  socket.emit("action", {
    roomId: currentRoomRef.current,
    userId: userIdRef.current,
    lastKnownCommit: lastKnownCommitRef.current,
    action: { type, timestamp, videoId },
  });
}

// ── Áp dụng state từ server
function applyCommit(data: CommitBroadcast, player: any) { ... }

// ── Extract videoId từ URL YouTube
const extractVideoId = (url: string): string => {
  const match = url.match(/^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/);
  return match && match[2].length === 11 ? match[2] : url;
};

// ── Refs quan trọng (dùng để tránh stale closure)
const currentRoomRef  = useRef<string | null>(null);   // roomId
const isPulling       = useRef(false);                  // chặn echo loop
const lastKnownCommitRef = useRef<string | null>(null); // HEAD commit
const playerRef       = useRef<any>(null);              // YouTube player
const nicknameRef     = useRef<string>("");             // nickname
```

---

## Phase 1 — Foundation

> **Mục tiêu:** Dọn dẹp base, tạo infrastructure cho components.  
> **Ưu tiên:** Cao — các Phase sau phụ thuộc vào đây.

---

### Step 1.1 — Tạo `src/pages/_app.tsx`

**Tại sao cần:** Pages Router không tự import `globals.css` — các trang hiện tại không có dark background.

```typescript
// src/pages/_app.tsx
import "@/app/globals.css";
import type { AppProps } from "next/app";

export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
```

---

### Step 1.2 — Cập nhật `src/app/globals.css`

**Thêm vào cuối file:**

```css
/* Force dark theme globally */
html, body {
  background: #03071a;
  color: #f9fafb;
  min-height: 100vh;
}

/* Scrollbar */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: #111827; }
::-webkit-scrollbar-thumb { background: #374151; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #4b5563; }
```

---

### Step 1.3 — Tạo `src/app/types/Socket.ts`

**Tập trung type definitions cho socket events:**

```typescript
// src/app/types/Socket.ts

export interface CommitBroadcast {
  commitId: string;
  videoId: string | null;
  timestamp: number;
  isPlaying: boolean;
  serverTime: number;
  hostUserId: string | null;
  conflictResolved: boolean;
}

export interface ChatMessagePayload {
  nickname: string;
  message: string;
  timestamp: number;
}

export interface EmojiReactionPayload {
  nickname: string;
  emoji: string;
}

export type ActionType = "PLAY" | "PAUSE" | "SEEK" | "LOAD_VIDEO";

export interface ActionPayload {
  roomId: string;
  userId: string;
  lastKnownCommit: string;
  action: {
    type: ActionType;
    timestamp: number;
    videoId?: string;
  };
}
```

---

### Step 1.4 — Tạo `src/app/lib/hooks/useNickname.ts`

**Hook tách biệt logic nickname khỏi component:**

```typescript
// src/app/lib/hooks/useNickname.ts
import { useState, useRef, useEffect } from "react";

export function useNickname() {
  const [nickname, setNickname] = useState("");
  const [showModal, setShowModal]   = useState(false);
  const nicknameRef = useRef("");

  useEffect(() => {
    const stored = localStorage.getItem("lwu_nickname");
    if (stored) {
      nicknameRef.current = stored;
      setNickname(stored);
    } else {
      setShowModal(true);
    }
  }, []);

  const saveNickname = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    localStorage.setItem("lwu_nickname", trimmed);
    nicknameRef.current = trimmed;
    setNickname(trimmed);
    setShowModal(false);
  };

  return { nickname, nicknameRef, showModal, saveNickname };
}
```

---

### Step 1.5 — Tạo `src/components/ui/Button.tsx`

```typescript
// src/components/ui/Button.tsx
type Variant = "primary" | "danger" | "ghost" | "outline";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
}

const variants: Record<Variant, string> = {
  primary: "bg-green-500 hover:bg-green-600 text-white font-bold",
  danger:  "bg-transparent border border-red-800 text-red-400 hover:bg-red-950",
  ghost:   "bg-transparent text-gray-400 hover:text-white hover:bg-gray-800",
  outline: "bg-transparent border border-sky-600 text-sky-400 hover:bg-sky-950",
};

export function Button({ variant = "primary", loading, children, className = "", ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 
                  text-sm transition-colors disabled:opacity-50 disabled:cursor-default
                  ${variants[variant]} ${className}`}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
      {children}
    </button>
  );
}
```

---

## Phase 2 — Landing & Entry Flow

> **Mục tiêu:** Người dùng có landing page đẹp, flow vào phòng rõ ràng.  
> **Tham khảo:** `demo-01-landing.html`, `demo-02-room-entry.html`

---

### Step 2.1 — Tạo `src/pages/index.tsx` (Landing Page)

**Reuse từ:** `demo-01-landing.html`  
**Firebase:** `src/app/lib/firebase.ts` để tạo phòng  
**Routing:** `next/router` (Pages Router)

```typescript
// src/pages/index.tsx
import { useState } from "react";
import { useRouter } from "next/router";
import { db } from "@/app/lib/firebase";
import { collection, addDoc } from "firebase/firestore";

export default function HomePage() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [joinCode, setJoinCode]   = useState("");
  const [error, setError]         = useState("");

  const createRoom = async () => {
    setCreating(true);
    const ref = await addDoc(collection(db, "rooms"), {
      createdAt: Date.now(),
      videoId: "",
      queue: [],
    });
    router.push(`/room/${ref.id}`);
    // Không setCreating(false) vì đang navigate
  };

  const joinRoom = () => {
    if (!joinCode.trim()) { setError("Nhập room code hoặc link"); return; }
    // Extract ID từ URL nếu cần
    const match = joinCode.match(/room\/([a-zA-Z0-9]+)/);
    const id = match ? match[1] : joinCode.trim();
    router.push(`/room/${id}`);
  };

  return ( /* Design từ demo-01-landing.html */ );
}
```

**Xóa sau khi xong:** `src/pages/create-room.tsx` (logic đã chuyển vào đây)

---

### Step 2.2 — Tạo `src/components/room/NicknameModal.tsx`

**Tách ra từ** `room/[id].tsx` (hiện tại đang inline)  
**Reuse:** Logic `useNickname` hook từ Step 1.4  
**Nâng cấp:** Thêm avatar color picker (từ `demo-02-room-entry.html`)

```typescript
// src/components/room/NicknameModal.tsx
import { useState } from "react";

const COLORS = ["#22c55e","#38bdf8","#a855f7","#f97316","#f43f5e","#facc15"];

interface Props {
  roomId: string;
  onJoin: (nickname: string, color: string) => void;
}

export function NicknameModal({ roomId, onJoin }: Props) {
  const [name, setName]   = useState(
    () => localStorage.getItem("lwu_nickname") ?? ""
  );
  const [color, setColor] = useState(COLORS[0]);

  const handleJoin = () => {
    if (!name.trim()) return;
    localStorage.setItem("lwu_nickname", name.trim());
    localStorage.setItem("lwu_color",    color);
    onJoin(name.trim(), color);
  };

  return (
    /* 
      Hiển thị:
      - Room badge: "⌂ Room {roomId.slice(0,8)}"
      - Avatar preview (circle, màu + chữ cái đầu của nickname)
      - Color swatches
      - Input nickname
      - Button "Join Room"
      
      Design từ: demo-02-room-entry.html — State A
    */
  );
}
```

---

### Step 2.3 — Tạo `src/components/room/EmptyState.tsx`

**Hai variant:** `host` và `viewer`  
**Tham khảo:** `demo-02-room-entry.html` — State B và C

```typescript
// src/components/room/EmptyState.tsx
interface Props {
  isHost: boolean;
  hostNickname?: string;
  memberCount: number;
  onLoadVideo: (videoId: string) => void;
}

export function EmptyState({ isHost, hostNickname, memberCount, onLoadVideo }: Props) {
  const [url, setUrl] = useState("");

  if (isHost) return (
    /* 
      - CSS ripple animation
      - Title: "Your room is ready!"
      - Sub: "You're the host. Load a YouTube video to start."
      - Input + Load button
      - Member count
    */
  );

  return (
    /*
      - CSS ripple animation
      - Title: "Waiting for the host…"
      - Sub: "{hostNickname} is choosing a video"
      - Blinking dot indicator
      - Member count
    */
  );
}
```

---

### Step 2.4 — Cập nhật `src/pages/join-room.tsx`

Thay vì xóa, redirect về landing để không break link cũ:

```typescript
// src/pages/join-room.tsx
import { useEffect } from "react";
import { useRouter } from "next/router";

export default function JoinRoom() {
  const router = useRouter();
  useEffect(() => { router.replace("/"); }, []);
  return null;
}
```

---

## Phase 3 — Room Page UI Polish

> **Mục tiêu:** Tách `room/[id].tsx` thành components, cải thiện layout.  
> **Quan trọng:** Không thay đổi logic sync — chỉ tách UI ra components.

---

### Step 3.1 — Tạo `src/components/room/Navbar.tsx`

**Tách ra từ** phần render của `room/[id].tsx`

```typescript
// src/components/room/Navbar.tsx
interface Props {
  roomId: string;
  isHost: boolean;
  hostUserId: string | null;
  connectionStatus: string;
  syncStatus: string;
  onLeave: () => void;
  onShare: () => void;  // mở ShareModal
}

export function Navbar({ roomId, isHost, connectionStatus, syncStatus, onLeave, onShare }: Props) {
  const copyRoom = () => {
    navigator.clipboard.writeText(`${window.location.origin}/room/${roomId}`);
    // toast.success("Room link copied!")
  };

  return (
    <nav className="h-[60px] bg-[#0d1117] border-b border-gray-800 flex items-center px-6 gap-3">
      {/* Leave button */}
      {/* Logo */}
      {/* Status pills: Connected | Room code (click=copy) | Host crown | Sync */}
      {/* Share button → onShare() */}
    </nav>
  );
}
```

---

### Step 3.2 — Tạo `src/components/room/VideoPlayer.tsx`

**Tách logic YouTube** khỏi `room/[id].tsx`  
**Tham khảo:** `YouTubeIframeManager.tsx` (trong App Router) làm reference

```typescript
// src/components/room/VideoPlayer.tsx
interface Props {
  onReady: (player: any) => void;
  onStateChange: (event: any, player: any) => void;
  floatingEmojis: FloatingEmoji[];
}

// Quan trọng: giữ nguyên logic init từ room/[id].tsx
// - loadFontAsync không cần ở đây
// - onYouTubeIframeAPIReady must be window-level
// - pendingCommitRef flush trong onReady

export function VideoPlayer({ onReady, onStateChange, floatingEmojis }: Props) {
  useEffect(() => {
    // Copy nguyên hàm initializeYouTubePlayer() từ room/[id].tsx
  }, []);

  return (
    <div className="relative flex justify-center">
      <div className="w-full max-w-[900px] aspect-video rounded-xl overflow-hidden 
                      border border-gray-800 shadow-[0_0_60px_rgba(34,197,94,0.1)]">
        <div id="player" className="w-full h-full" />
      </div>
      {/* Floating emojis overlay */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {floatingEmojis.map(e => (
          <div key={e.id} className="float-emoji absolute bottom-0 text-4xl" style={{ left: `${e.x}%` }}>
            {e.emoji}
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

### Step 3.3 — Tạo `src/components/room/ControlsBar.tsx`

```typescript
// src/components/room/ControlsBar.tsx
interface Props {
  disabled: boolean;  // true nếu player chưa sẵn sàng
  onLoad: (videoId: string) => void;
  onForceSync: () => void;
}

export function ControlsBar({ disabled, onLoad, onForceSync }: Props) {
  const [url, setUrl] = useState("");

  const handleLoad = () => {
    const vid = extractVideoId(url.trim()); // reuse từ room/[id].tsx
    if (vid) { onLoad(vid); setUrl(""); }
  };

  return (
    <div className="flex gap-2 w-full max-w-[900px]">
      <input value={url} onChange={e=>setUrl(e.target.value)}
             onKeyDown={e=>e.key==="Enter" && handleLoad()}
             placeholder="YouTube URL or video ID…"
             className="flex-1 h-[42px] bg-[#0f172a] border border-green-500 rounded-lg px-3 
                        text-white text-sm outline-none focus:border-green-400 
                        placeholder-gray-600" />
      <Button onClick={handleLoad} disabled={disabled || !url.trim()}>Load</Button>
      <Button variant="outline" onClick={onForceSync}>⟳ Sync</Button>
    </div>
  );
}
```

---

### Step 3.4 — Tạo `src/components/room/EmojiBar.tsx`

**Tách ra từ** `room/[id].tsx` — giữ nguyên long-press logic

```typescript
// src/components/room/EmojiBar.tsx
const DEFAULT_EMOJIS = ["👍","❤️","😂","😮","😢","🔥"];

interface Props {
  onSend: (emoji: string) => void;
}

export function EmojiBar({ onSend }: Props) {
  const [showPicker, setShowPicker] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Copy nguyên handleEmojiMouseDown/Up/Leave từ room/[id].tsx
  
  return ( /* ... */ );
}
```

---

### Step 3.5 — Refactor `src/pages/room/[id].tsx`

Sau khi tạo xong các components, refactor lại file chính:

```typescript
// src/pages/room/[id].tsx — SAU REFACTOR (~150 dòng thay vì ~700)
export default function RoomPage() {
  const { nickname, nicknameRef, showModal, saveNickname } = useNickname();
  
  // ── State (giữ nguyên tất cả state và refs quan trọng) ──────
  const [player, setPlayer]       = useState(null);
  const [currentRoom, setRoom]    = useState(null);
  const [isHost, setIsHost]       = useState(false);
  const [chatOpen, setChatOpen]   = useState(false);
  // ... các state khác

  // ── Logic (giữ nguyên: commitAction, applyCommit, sync effects) ──
  // commitAction(), applyCommit(), fetchRoomState() → KHÔNG THAY ĐỔI

  // ── Render ──────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#03071a] text-white">
      <Navbar roomId={currentRoom} isHost={isHost} ... />
      
      <main className="flex flex-col items-center gap-4 p-5">
        {!hasVideo ? (
          <EmptyState isHost={isHost} onLoadVideo={loadVideo} ... />
        ) : (
          <>
            <VideoPlayer onReady={...} onStateChange={...} floatingEmojis={...} />
            <ControlsBar onLoad={loadVideo} onForceSync={fetchRoomState} />
            <EmojiBar onSend={sendEmoji} />
          </>
        )}
      </main>

      <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} ... />
      <ShareModal open={shareOpen} roomId={currentRoom} onClose={...} />
      
      {showModal && <NicknameModal roomId={id} onJoin={saveNickname} />}
    </div>
  );
}
```

---

## Phase 4 — Features mới

> **Mục tiêu:** Thêm Share modal, responsive, toast notifications.

---

### Step 4.1 — Tạo `src/components/room/ShareModal.tsx`

**Tham khảo:** `demo-03-share.html`

```typescript
// src/components/room/ShareModal.tsx
interface Props {
  open: boolean;
  roomId: string;
  onClose: () => void;
}

export function ShareModal({ open, roomId, onClose }: Props) {
  const url = `${window.location.origin}/room/${roomId}`;
  const [tab, setTab] = useState<"link"|"qr">("link");
  const [copied, setCopied] = useState(false);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Copied!"); // react-hot-toast đã cài
    setTimeout(() => setCopied(false), 2500);
  };

  if (!open) return null;
  return (
    /* 
      Overlay + modal card
      Tab "Link": room code lớn + copy + full URL + share buttons
      Tab "QR":   QR code + download
      
      Design từ: demo-03-share.html
    */
  );
}
```

---

### Step 4.2 — Thêm Share button vào Navbar

Trong `Navbar.tsx`, thêm button mở `ShareModal`:

```typescript
// Trong Navbar.tsx
<button onClick={onShare}
  className="pill bg-[#0f172a] border border-sky-800 text-sky-400 hover:bg-sky-950">
  🔗 Share
</button>
```

Trong `room/[id].tsx`, thêm state và handler:

```typescript
const [shareOpen, setShareOpen] = useState(false);
// Truyền vào Navbar: onShare={() => setShareOpen(true)}
// Render: <ShareModal open={shareOpen} roomId={currentRoom} onClose={() => setShareOpen(false)} />
```

---

### Step 4.3 — Toast notifications thống nhất

`react-hot-toast` đã cài. Thêm `<Toaster>` vào `_app.tsx`:

```typescript
// src/pages/_app.tsx
import "@/app/globals.css";
import { Toaster } from "react-hot-toast";
import type { AppProps } from "next/app";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Component {...pageProps} />
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: "#111827",
            color: "#f9fafb",
            border: "1px solid #374151",
            borderRadius: "10px",
            fontSize: "13px",
          },
          success: { iconTheme: { primary: "#22c55e", secondary: "#fff" } },
        }}
      />
    </>
  );
}
```

Xóa `<Toaster />` đang inline trong `room/[id].tsx`.

---

### Step 4.4 — Responsive layout cho Video

Thay thế YouTube player cố định `640×360` bằng responsive:

```typescript
// Trong VideoPlayer.tsx — initializeYouTubePlayer()
const p = new YT.Player("player", {
  height: "100%",   // ← đổi từ "360"
  width:  "100%",   // ← đổi từ "640"
  // ... giữ nguyên các options khác
});

// Container sử dụng aspect-video:
<div className="w-full max-w-[900px] aspect-video rounded-xl overflow-hidden">
  <div id="player" className="w-full h-full" />
</div>
```

---

## Checklist tổng

### Phase 1 — Foundation

- [ ] Tạo `src/pages/_app.tsx`
- [ ] Cập nhật `src/app/globals.css` (dark bg + scrollbar)
- [ ] Tạo `src/app/types/Socket.ts`
- [ ] Tạo `src/app/lib/hooks/useNickname.ts`
- [ ] Tạo `src/components/ui/Button.tsx`
- [ ] Tạo `src/components/ui/Input.tsx`
- [ ] Tạo thư mục `src/components/room/` và `src/components/layout/`

### Phase 2 — Landing & Entry

- [ ] Tạo `src/pages/index.tsx` (landing page — từ demo-01)
- [ ] Xóa `src/pages/create-room.tsx` (logic merge vào index)
- [ ] Cập nhật `src/pages/join-room.tsx` → redirect về `/`
- [ ] Tạo `src/components/room/NicknameModal.tsx` (từ demo-02)
- [ ] Tạo `src/components/room/EmptyState.tsx` (từ demo-02)

### Phase 3 — Room Page Refactor

- [ ] Tạo `src/components/room/Navbar.tsx`
- [ ] Tạo `src/components/room/VideoPlayer.tsx`
- [ ] Tạo `src/components/room/ControlsBar.tsx`
- [ ] Tạo `src/components/room/EmojiBar.tsx`
- [ ] Tạo `src/components/room/ChatPanel.tsx`
- [ ] Refactor `src/pages/room/[id].tsx` dùng các components trên
- [ ] Test sync vẫn hoạt động sau refactor

### Phase 4 — Features mới

- [ ] Tạo `src/components/room/ShareModal.tsx` (từ demo-03)
- [ ] Thêm Share button vào Navbar
- [ ] Cập nhật `_app.tsx` — global Toaster
- [ ] Cập nhật VideoPlayer → responsive `aspect-video`
- [ ] Test build: `npm run build`

---

## Lưu ý quan trọng

### ❌ KHÔNG thay đổi
- `src/pages/api/socket.ts` — sync protocol đang hoạt động tốt
- `src/app/lib/socket-room.ts` — socket singleton
- `src/app/lib/firebase.ts` — đã fix

### ⚠️ Cẩn thận khi refactor `room/[id].tsx`
Logic sync sử dụng nhiều `useRef` để tránh stale closure.  
Khi tách component, phải **truyền ref xuống qua props** hoặc giữ logic ở parent:

```typescript
// ✅ Đúng — logic giữ ở parent, truyền callbacks xuống
<VideoPlayer onReady={(p) => { playerRef.current = p; setPlayer(p); }} />

// ❌ Sai — không để logic sync bên trong VideoPlayer
// Vì VideoPlayer sẽ không có access vào currentRoomRef, lastKnownCommitRef...
```

### 📁 Import alias
```typescript
@/* → src/*

// Ví dụ:
import { Button }      from "@/components/ui/Button";
import { NicknameModal } from "@/components/room/NicknameModal";
import { db }           from "@/app/lib/firebase";
import socket           from "@/app/lib/socket-room";
import { useNickname }  from "@/app/lib/hooks/useNickname";
```

### 🎨 Design tokens
```css
/* Dùng trong Tailwind hoặc CSS variables */
bg-[#03071a]   /* trang chủ */
bg-[#0d1117]   /* navbar */
bg-[#111827]   /* card, chat panel */
bg-[#1f2937]   /* border */
text-green-500 /* primary */
text-sky-400   /* secondary */
text-yellow-400 /* host crown */
text-red-400   /* danger */
```

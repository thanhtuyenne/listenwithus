"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import socket from "@/app/lib/socket-room";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faEarthAfrica,
  faHome,
  faRotate,
  faCrown,
  faComment,
  faPaperPlane,
  faXmark,
  faFaceSmile,
} from "@fortawesome/free-solid-svg-icons";
import { Toaster } from "react-hot-toast";

declare const YT: any;

type ActionType = "PLAY" | "PAUSE" | "SEEK" | "LOAD_VIDEO";

interface CommitBroadcast {
  commitId: string;
  videoId: string | null;
  timestamp: number;
  isPlaying: boolean;
  serverTime: number;
  hostUserId: string | null;
  conflictResolved: boolean;
}

interface ChatMessage {
  id: string;
  nickname: string;
  message: string;
  timestamp: number;
  isSelf: boolean;
}

interface FloatingEmoji {
  id: string;
  emoji: string;
  x: number;
}

const DEFAULT_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];
const EXTENDED_EMOJIS = [
  "👍", "❤️", "😂", "😮", "😢", "🔥",
  "🎉", "👏", "😍", "🤩", "😭", "💀",
  "🙏", "😤", "🥹", "✨", "🎵", "💯",
  "🤯", "👀", "💪", "🫶", "🥳", "🤣",
];

function generateId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function getUserId(): string {
  let id = localStorage.getItem("lwu_userId");
  if (!id) {
    id = generateId();
    localStorage.setItem("lwu_userId", id);
  }
  return id;
}

export default function RoomPage() {
  const params = useParams();
  const id = params?.id as string;

  const [player, setPlayer] = useState<any>(null);
  const [currentRoom, setCurrentRoom] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState("Disconnected");
  const [syncStatus, setSyncStatus] = useState<string>("Not synced");
  const [isHost, setIsHost] = useState(false);
  const [hostUserId, setHostUserId] = useState<string | null>(null);

  // Nickname
  const [nickname, setNickname] = useState<string>("");
  const [showNicknameModal, setShowNicknameModal] = useState(false);
  const [nicknameInput, setNicknameInput] = useState("");

  // Chat
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);

  // Emoji
  const [floatingEmojis, setFloatingEmojis] = useState<FloatingEmoji[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const currentRoomRef = useRef<string | null>(null);
  const isPulling = useRef(false);
  const lastKnownCommitRef = useRef<string | null>(null);
  const lastPushedTimestampRef = useRef<number>(-1);
  const userIdRef = useRef<string>("");
  const nicknameRef = useRef<string>("");
  const playerRef = useRef<any>(null);
  const pendingCommitRef = useRef<CommitBroadcast | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatOpenRef = useRef(false);

  // ─── YouTube Player ──────────────────────────────────────────────

  function initializeYouTubePlayer() {
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    const first = document.getElementsByTagName("script")[0];
    first.parentNode?.insertBefore(tag, first);

    (window as any).onYouTubeIframeAPIReady = () => {
      const p = new (window as any).YT.Player("player", {
        height: "360",
        width: "640",
        playerVars: { enablejsapi: 1, playsinline: 1, origin: window.location.origin },
        events: {
          onReady: () => {
            playerRef.current = p;
            setPlayer(p);
            if (pendingCommitRef.current) {
              applyCommit(pendingCommitRef.current, p);
              pendingCommitRef.current = null;
            }
          },
          onStateChange: (event: any) => handlePlayerStateChange(event, p),
          onError: (event: any) => alert(`Video player error: ${event.data}`),
        },
      });
    };
  }

  // ─── Player State → Action ────────────────────────────────────────

  function handlePlayerStateChange(event: any, p: any) {
    if (isPulling.current) return;
    const timestamp = p.getCurrentTime();
    if (event.data === (window as any).YT.PlayerState.PLAYING) {
      commitAction("PLAY", timestamp);
    } else if (event.data === (window as any).YT.PlayerState.PAUSED) {
      commitAction("PAUSE", timestamp);
    }
  }

  // ─── Emit Action ──────────────────────────────────────────────────

  function commitAction(type: ActionType, timestamp: number, videoId?: string) {
    const roomId = currentRoomRef.current;
    const commit = lastKnownCommitRef.current;
    if (!roomId || !commit) return;
    socket.emit("action", {
      roomId,
      userId: userIdRef.current,
      lastKnownCommit: commit,
      action: { type, timestamp, videoId },
    });
  }

  // ─── Apply Incoming Commit ────────────────────────────────────────

  function applyCommit(data: CommitBroadcast, p: any) {
    if (!p) return;

    setHostUserId(data.hostUserId);
    setIsHost(data.hostUserId === userIdRef.current);
    setSyncStatus("Syncing...");
    isPulling.current = true;

    const networkDelay = data.isPlaying ? (Date.now() - data.serverTime) / 2 : 0;
    const compensatedTimestamp = data.timestamp + networkDelay / 1000;

    if (data.videoId && data.videoId !== p.getVideoData()?.video_id) {
      p.loadVideoById(data.videoId, compensatedTimestamp);
      p.setPlaybackRate(1.0);
    } else if (p.getVideoData()?.video_id) {
      const drift = p.getCurrentTime() - compensatedTimestamp;
      if (data.conflictResolved || drift > 3 || drift < -3) {
        p.seekTo(compensatedTimestamp);
        p.setPlaybackRate(1.0);
      }
    }

    if (p.getVideoData()?.video_id) {
      const playing = p.getPlayerState() === YT.PlayerState.PLAYING;
      if (data.isPlaying !== playing) {
        if (data.isPlaying) {
          p.playVideo();
        } else {
          p.pauseVideo();
          p.setPlaybackRate(1.0);
        }
      }
    }

    setTimeout(() => {
      isPulling.current = false;
      setSyncStatus("Synced");
    }, 500);
  }

  // ─── Room Management ──────────────────────────────────────────────

  function joinRoom(roomId: string) {
    setCurrentRoom(roomId);
    currentRoomRef.current = roomId;
    socket.emit("joinRoom", { roomId, userId: userIdRef.current });
  }

  function leaveRoom() {
    const roomId = currentRoomRef.current;
    if (!roomId) return alert("You are not in any room");
    socket.emit("leaveRoom", roomId);
    setCurrentRoom(null);
    currentRoomRef.current = null;
  }

  function loadVideo() {
    const p = player;
    const roomId = currentRoomRef.current;
    if (!p || !roomId) return alert("Player not ready");
    const raw = (document.getElementById("videoId") as HTMLInputElement).value.trim();
    const videoId = extractVideoId(raw);
    if (!videoId) return alert("Invalid video ID or URL");
    p.loadVideoById(videoId);
    commitAction("LOAD_VIDEO", 0, videoId);
  }

  async function fetchRoomState() {
    const roomId = currentRoomRef.current;
    if (!roomId) return;
    socket.emit("fetch", roomId);
  }

  const extractVideoId = (url: string): string => {
    const match = url.match(/^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/);
    return match && match[2].length === 11 ? match[2] : url;
  };

  // ─── Chat ─────────────────────────────────────────────────────────

  function sendMessage() {
    const msg = inputMessage.trim();
    const roomId = currentRoomRef.current;
    if (!msg || !roomId) return;
    socket.emit("chatMessage", { roomId, nickname: nicknameRef.current, message: msg });
    setInputMessage("");
  }

  // ─── Emoji ────────────────────────────────────────────────────────

  function sendEmoji(emoji: string) {
    const roomId = currentRoomRef.current;
    if (!roomId) return;
    socket.emit("emojiReaction", { roomId, nickname: nicknameRef.current, emoji });
    setShowEmojiPicker(false);
  }

  function spawnFloatingEmoji(emoji: string) {
    const emojiId = generateId();
    const x = 10 + Math.random() * 80;
    setFloatingEmojis((prev) => [...prev, { id: emojiId, emoji, x }]);
    setTimeout(() => {
      setFloatingEmojis((prev) => prev.filter((e) => e.id !== emojiId));
    }, 3000);
  }

  function handleEmojiMouseDown(emoji: string) {
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      setShowEmojiPicker(true);
    }, 500);
  }

  function handleEmojiMouseUp(emoji: string) {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
      sendEmoji(emoji);
    }
  }

  function handleEmojiMouseLeave() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  // ─── Nickname ─────────────────────────────────────────────────────

  function submitNickname() {
    const trimmed = nicknameInput.trim();
    if (!trimmed) return;
    localStorage.setItem("lwu_nickname", trimmed);
    nicknameRef.current = trimmed;
    setNickname(trimmed);
    setShowNicknameModal(false);
  }

  // ─── Effects ──────────────────────────────────────────────────────

  useEffect(() => {
    userIdRef.current = getUserId();
    const stored = localStorage.getItem("lwu_nickname");
    if (stored) {
      nicknameRef.current = stored;
      setNickname(stored);
    } else {
      setShowNicknameModal(true);
    }
  }, []);

  // Gate room join on nickname being set
  useEffect(() => {
    if (!id || !nickname) return;
    joinRoom(id);
  }, [id, nickname]);

  // Keep chatOpenRef in sync for use in socket handlers
  useEffect(() => { chatOpenRef.current = chatOpen; }, [chatOpen]);

  // Auto-scroll chat to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Always-on commit listener — buffers if player not ready yet
  useEffect(() => {
    const handler = (data: CommitBroadcast) => {
      lastKnownCommitRef.current = data.commitId;
      if (playerRef.current) {
        applyCommit(data, playerRef.current);
      } else {
        pendingCommitRef.current = data;
      }
    };
    socket.on("commit", handler);
    return () => { socket.off("commit", handler); };
  }, []);

  // Chat listener
  useEffect(() => {
    const handler = ({ nickname: from, message, timestamp }: { nickname: string; message: string; timestamp: number }) => {
      const isSelf = from === nicknameRef.current;
      setMessages((prev) => [...prev, { id: generateId(), nickname: from, message, timestamp, isSelf }]);
      if (!chatOpenRef.current) setUnreadCount((c) => c + 1);
    };
    socket.on("chatMessage", handler);
    return () => { socket.off("chatMessage", handler); };
  }, []);

  // Emoji reaction listener
  useEffect(() => {
    const handler = ({ emoji }: { nickname: string; emoji: string }) => {
      spawnFloatingEmoji(emoji);
    };
    socket.on("emojiReaction", handler);
    return () => { socket.off("emojiReaction", handler); };
  }, []);

  // Catch-up sync
  useEffect(() => {
    const handler = ({ referenceTime, serverTime }: { referenceTime: number; serverTime: number }) => {
      const p = playerRef.current;
      if (!p || p.getPlayerState() !== YT.PlayerState.PLAYING) return;
      const latency = (Date.now() - serverTime) / 2000;
      const target = referenceTime + latency;
      const behind = target - p.getCurrentTime();
      if (behind > 3) {
        p.seekTo(target);
        p.setPlaybackRate(1.0);
        setSyncStatus("Re-syncing...");
      } else if (behind > 0.5) {
        p.setPlaybackRate(1.5);
        setSyncStatus("Catching up...");
      } else {
        p.setPlaybackRate(1.0);
        setSyncStatus("Synced");
      }
    };
    socket.on("sync", handler);
    return () => { socket.off("sync", handler); };
  }, []);

  // Fetch once both room and player are ready (late-join catch-up)
  useEffect(() => {
    if (!currentRoom || !player) return;
    fetchRoomState();
  }, [currentRoom, player]);

  // Socket lifecycle
  useEffect(() => {
    socket.on("connect", () => {
      setConnectionStatus("Connected");
      const roomId = currentRoomRef.current;
      if (roomId) {
        socket.emit("joinRoom", { roomId, userId: userIdRef.current });
        fetchRoomState();
      }
    });
    socket.on("disconnect", () => {
      setConnectionStatus("Disconnected");
      if (player) player.pauseVideo();
    });
    socket.on("reconnect_error", () => setConnectionStatus("Reconnecting..."));
    socket.on("reconnect_failed", () => setConnectionStatus("Connection lost"));
    socket.on("hostChanged", ({ hostUserId: newHost }: { hostUserId: string | null }) => {
      setHostUserId(newHost);
      setIsHost(newHost === userIdRef.current);
    });

    window.fetch("/api/socket").finally(() => {
      if (!socket.connected) socket.connect();
      setConnectionStatus(socket.connected ? "Connected" : "Disconnected");
    });

    initializeYouTubePlayer();

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("reconnect_error");
      socket.off("reconnect_failed");
      socket.off("hostChanged");
    };
  }, []);

  // Periodic heartbeat while playing
  useEffect(() => {
    const interval = setInterval(() => {
      const roomId = currentRoomRef.current;
      if (!roomId || !player || player.getPlayerState() !== YT.PlayerState.PLAYING) return;
      const currentTime = player.getCurrentTime();
      if (Math.abs(currentTime - lastPushedTimestampRef.current) > 0.5) {
        lastPushedTimestampRef.current = currentTime;
        socket.emit("heartbeat", { roomId, timestamp: currentTime });
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [player]);

  // ─── Render ───────────────────────────────────────────────────────

  return (
    <div className="relative min-h-screen bg-gray-950 text-white">
      <style>{`
        @keyframes floatUp {
          0%   { transform: translateY(0) scale(1);   opacity: 1; }
          80%  { opacity: 1; }
          100% { transform: translateY(-180px) scale(1.5); opacity: 0; }
        }
        .float-emoji { animation: floatUp 3s ease-out forwards; }
        .chat-panel  { transition: transform 0.3s cubic-bezier(0.4,0,0.2,1); }
      `}</style>

      {/* Header */}
      <h1 className="text-green-500 text-center font-bold text-3xl font-quickSand py-4">
        LISTEN WITH US
      </h1>

      {currentRoom && (
        <button
          onClick={leaveRoom}
          className="flex gap-2 items-center text-red-400 font-bold cursor-pointer absolute top-5 left-2 text-sm"
        >
          <FontAwesomeIcon icon={faArrowLeft} size="1x" />
          <span>LEAVE THE ROOM</span>
        </button>
      )}

      {/* Status bar + controls */}
      <div className="flex items-center flex-row-reverse justify-between mx-2">
        <div className="status-bar flex justify-between w-[500px] px-4 text-sm">
          <span>
            <FontAwesomeIcon icon={faEarthAfrica} />{" "}
            <strong className={connectionStatus === "Connected" ? "text-green-400" : "text-red-400"}>
              {connectionStatus}
            </strong>
          </span>
          <span>
            <FontAwesomeIcon icon={faHome} />{" "}
            <strong className={currentRoom ? "text-green-400" : "text-gray-500"}>
              {currentRoom ? currentRoom.slice(0, 8) + "…" : "None"}
            </strong>
          </span>
          <span>
            <FontAwesomeIcon icon={faCrown} />{" "}
            <strong className={isHost ? "text-yellow-400" : "text-gray-500"}>
              {isHost ? "Host" : hostUserId ? hostUserId.slice(0, 6) + "…" : "—"}
            </strong>
          </span>
          <span>
            <FontAwesomeIcon icon={faRotate} />{" "}
            <strong className="text-gray-300">{syncStatus}</strong>
          </span>
        </div>

        <div className="controls my-4">
          {currentRoom && (
            <div className="flex gap-2">
              <input
                className="h-[38px] w-[200px] border rounded-md border-green-400 py-1 px-2 outline-none focus:border-green-500 focus:border-2 transition-all bg-gray-900 text-white placeholder-gray-500"
                type="text"
                id="videoId"
                placeholder="YouTube URL or ID"
                disabled={!player}
              />
              <button
                className="bg-green-500 text-white rounded-md px-3 py-1 hover:bg-green-600 transition-colors"
                onClick={loadVideo}
              >
                Load
              </button>
              <button
                className="bg-transparent border border-cyan-600 text-cyan-400 rounded-md px-3 py-1 hover:bg-cyan-950 transition-colors text-sm"
                onClick={fetchRoomState}
              >
                Force Sync
              </button>
            </div>
          )}
        </div>
      </div>

      <Toaster />

      {/* Player area with floating emojis */}
      <div className="relative flex justify-center">
        <div id="player" />
        {floatingEmojis.map((e) => (
          <div
            key={e.id}
            className="float-emoji pointer-events-none absolute bottom-0 text-4xl select-none"
            style={{ left: `${e.x}%` }}
          >
            {e.emoji}
          </div>
        ))}
      </div>

      {/* Emoji bar */}
      {currentRoom && (
        <div className="flex justify-center items-center gap-3 mt-5">
          {DEFAULT_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              className="text-2xl hover:scale-125 active:scale-110 transition-transform select-none cursor-pointer"
              onMouseDown={() => handleEmojiMouseDown(emoji)}
              onMouseUp={() => handleEmojiMouseUp(emoji)}
              onMouseLeave={handleEmojiMouseLeave}
              onTouchStart={(e) => { e.preventDefault(); handleEmojiMouseDown(emoji); }}
              onTouchEnd={(e) => { e.preventDefault(); handleEmojiMouseUp(emoji); }}
            >
              {emoji}
            </button>
          ))}
          <button
            className="text-xl text-gray-400 hover:text-white hover:scale-125 transition-all cursor-pointer ml-1"
            onClick={() => setShowEmojiPicker(true)}
            title="More emojis (or hold any emoji)"
          >
            <FontAwesomeIcon icon={faFaceSmile} />
          </button>
        </div>
      )}

      {/* Extended emoji picker modal */}
      {showEmojiPicker && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center pb-10"
          onClick={() => setShowEmojiPicker(false)}
        >
          <div
            className="bg-gray-800 border border-gray-700 rounded-2xl p-4 w-72 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-3">
              <span className="text-sm font-semibold text-gray-300">React</span>
              <button onClick={() => setShowEmojiPicker(false)} className="text-gray-500 hover:text-white">
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
            <div className="grid grid-cols-6 gap-2">
              {EXTENDED_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  className="text-2xl hover:scale-125 transition-transform p-1"
                  onClick={() => sendEmoji(emoji)}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Chat toggle button */}
      {currentRoom && (
        <button
          onClick={() => {
            setChatOpen((o) => !o);
            setUnreadCount(0);
          }}
          className="fixed bottom-6 right-6 z-40 bg-green-500 hover:bg-green-600 text-white w-12 h-12 rounded-full flex items-center justify-center shadow-xl transition-colors"
        >
          <FontAwesomeIcon icon={faComment} />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold leading-none">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      )}

      {/* Chat panel */}
      <div
        className={`chat-panel fixed top-0 right-0 h-full w-80 bg-gray-900 border-l border-gray-800 shadow-2xl flex flex-col z-50 ${
          chatOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Panel header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
          <span className="font-bold text-green-400 text-sm tracking-wide">CHAT</span>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500 truncate max-w-[120px]">{nickname}</span>
            <button onClick={() => setChatOpen(false)} className="text-gray-500 hover:text-white transition-colors">
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2 min-h-0">
          {messages.length === 0 && (
            <p className="text-gray-600 text-sm text-center mt-10 select-none">
              No messages yet.<br />Say hi! 👋
            </p>
          )}
          {messages.map((msg) => (
            <div key={msg.id} className={`flex flex-col ${msg.isSelf ? "items-end" : "items-start"}`}>
              <span className="text-xs text-gray-500 mb-1 px-1">{msg.nickname}</span>
              <div
                className={`px-3 py-2 rounded-2xl text-sm max-w-[85%] break-words leading-snug ${
                  msg.isSelf
                    ? "bg-green-600 text-white rounded-br-none"
                    : "bg-gray-700 text-gray-100 rounded-bl-none"
                }`}
              >
                {msg.message}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="px-3 py-3 border-t border-gray-800 flex gap-2 shrink-0">
          <input
            className="flex-1 bg-gray-800 text-white rounded-full px-4 py-2 text-sm outline-none focus:ring-1 focus:ring-green-500 placeholder-gray-600"
            placeholder="Type a message…"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          />
          <button
            onClick={sendMessage}
            disabled={!inputMessage.trim()}
            className="bg-green-500 hover:bg-green-600 disabled:bg-gray-700 disabled:text-gray-600 text-white w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-colors"
          >
            <FontAwesomeIcon icon={faPaperPlane} size="sm" />
          </button>
        </div>
      </div>

      {/* Chat backdrop */}
      {chatOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={() => setChatOpen(false)}
        />
      )}

      {/* Nickname modal */}
      {showNicknameModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 w-80 shadow-2xl">
            <h2 className="text-green-400 font-bold text-2xl mb-1 text-center font-quickSand">
              Welcome!
            </h2>
            <p className="text-gray-500 text-sm text-center mb-6">
              Choose a nickname to join the room
            </p>
            <input
              autoFocus
              className="w-full bg-gray-800 text-white rounded-lg px-4 py-2 outline-none focus:ring-2 focus:ring-green-500 mb-4 placeholder-gray-600"
              placeholder="Your nickname"
              value={nicknameInput}
              onChange={(e) => setNicknameInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitNickname()}
              maxLength={24}
            />
            <button
              onClick={submitNickname}
              disabled={!nicknameInput.trim()}
              className="w-full bg-green-500 hover:bg-green-600 disabled:bg-gray-800 disabled:text-gray-600 text-white font-bold py-2 rounded-lg transition-colors"
            >
              Join Room
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

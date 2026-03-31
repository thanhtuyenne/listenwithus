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

  const currentRoomRef = useRef<string | null>(null);
  const isPulling = useRef(false);
  const lastKnownCommitRef = useRef<string | null>(null);
  const lastPushedTimestampRef = useRef<number>(-1);
  const userIdRef = useRef<string>("");
  // Mirror of player state for use in always-on callbacks
  const playerRef = useRef<any>(null);
  // Buffer commits that arrive before the YouTube player is ready
  const pendingCommitRef = useRef<CommitBroadcast | null>(null);

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
            // Apply any commit that arrived before the player was ready
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
    const videoId = p.getVideoData()?.video_id;
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
    console.log("commit", data.commitId, "conflict:", data.conflictResolved);

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
      // Force seek on conflict or large drift (>3s); small drifts handled by sync event
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

  function transferHost(targetUserId: string) {
    const roomId = currentRoomRef.current;
    if (!roomId) return;
    socket.emit("transferHost", { roomId, userId: userIdRef.current, targetUserId });
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

  // ─── Effects ──────────────────────────────────────────────────────

  useEffect(() => {
    userIdRef.current = getUserId();
  }, []);

  useEffect(() => {
    if (!id) return;
    joinRoom(id);
  }, [id]);

  // Always-on commit listener — buffers if player not ready yet
  useEffect(() => {
    const handler = (data: CommitBroadcast) => {
      lastKnownCommitRef.current = data.commitId;
      if (playerRef.current) {
        applyCommit(data, playerRef.current);
      } else {
        // Player not ready — store latest commit, apply on onReady
        pendingCommitRef.current = data;
      }
    };
    socket.on("commit", handler);
    return () => { socket.off("commit", handler); };
  }, []);

  // Fetch once both room and player are ready (late-join catch-up)
  useEffect(() => {
    if (!currentRoom || !player) return;
    fetchRoomState();
  }, [currentRoom, player]);

  // Catch-up sync — adjust playback rate so slow clients converge without hard seek
  useEffect(() => {
    const handler = ({ referenceTime, serverTime }: { referenceTime: number; serverTime: number }) => {
      const p = playerRef.current;
      if (!p || p.getPlayerState() !== YT.PlayerState.PLAYING) return;
      const latency = (Date.now() - serverTime) / 2000; // seconds
      const target = referenceTime + latency;
      const behind = target - p.getCurrentTime(); // positive = client is behind
      if (behind > 3) {
        // More than 3s behind: hard seek
        p.seekTo(target);
        p.setPlaybackRate(1.0);
        setSyncStatus("Re-syncing...");
      } else if (behind > 0.5) {
        // 0.5–3s behind: speed up to catch up silently
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

  // Periodic heartbeat while playing — updates server timestamp without creating a new commitId
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
    <div className="relative">
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

      <div className="flex items-center flex-row-reverse justify-between mx-2">
        <div className="status-bar flex justify-between w-[500px] float-end px-4">
          <span>
            <FontAwesomeIcon icon={faEarthAfrica} />{" "}
            <strong className={connectionStatus === "Connected" ? "text-green-400" : "text-red-400"}>
              {connectionStatus}
            </strong>
          </span>
          <span>
            <FontAwesomeIcon icon={faHome} />{" "}
            <strong className={currentRoom ? "text-green-400" : "text-gray-400"}>
              {currentRoom ? currentRoom.slice(0, 8) + "…" : "None"}
            </strong>
          </span>
          <span>
            <FontAwesomeIcon icon={faCrown} />{" "}
            <strong className={isHost ? "text-yellow-400" : "text-gray-400"}>
              {isHost ? "Host" : hostUserId ? hostUserId.slice(0, 6) + "…" : "—"}
            </strong>
          </span>
          <span>
            <FontAwesomeIcon icon={faRotate} />{" "}
            <strong className="text-black">{syncStatus}</strong>
          </span>
        </div>

        <div className="controls my-4">
          {currentRoom && (
            <div className="flex gap-2">
              <input
                className="h-[38px] w-[200px] border rounded-md border-green-400 py-1 px-2 outline-none focus:border-green-500 focus:border-2 transition-[0.35s]"
                type="text"
                id="videoId"
                placeholder="YouTube URL or ID"
                disabled={!player}
              />
              <button
                className="bg-green-400 text-white rounded-md px-2 py-1 hover:bg-green-500 transition-[0.5s]"
                onClick={loadVideo}
              >
                Load Video
              </button>
              <button
                className="bg-cyan-950 border-cyan-400 border text-white rounded-md px-2 py-1"
                onClick={fetchRoomState}
              >
                Force Sync
              </button>
            </div>
          )}
        </div>
      </div>

      <Toaster />

      <div className="flex place-self-center">
        <div id="player" />
      </div>
    </div>
  );
}

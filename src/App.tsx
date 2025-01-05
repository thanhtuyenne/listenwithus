import React, { useState, useEffect } from "react";
import {
  initializeYouTubePlayer,
  joinRoom,
  loadVideo,
  requestSync,
  socket,
} from "./main";

declare const YT: any;

const App: React.FC = () => {
  const [player, setPlayer] = useState<any>(null);
  const [currentRoom, setCurrentRoom] = useState<string | null>(null);
  const [isSyncUpdate, setIsSyncUpdate] = useState(false);
  const [lastUpdateTime, setLastUpdateTime] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState("Disconnected");
  const [syncStatus, setSyncStatus] = useState("Not synced");

  useEffect(() => {
    initializeYouTubePlayer(
      setPlayer,
      setConnectionStatus,
      setSyncStatus,
      setIsSyncUpdate
    );

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("videoStateUpdate");
      socket.off("syncState");
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (
        currentRoom &&
        player &&
        player.getPlayerState() === YT.PlayerState.PLAYING
      ) {
        const now = Date.now();
        if (now - lastUpdateTime > 5000) {
          const videoId = player.getVideoData().video_id;
          const timestamp = player.getCurrentTime();
          requestSync(currentRoom, videoId, timestamp, true);
          setLastUpdateTime(now);
        }
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [currentRoom, player, lastUpdateTime]);

  return (
    <div>
      <div className="error-message" id="errorMessage"></div>

      <div className="status-bar">
        <span>
          Status: <strong>{connectionStatus}</strong>
        </span>
        <span style={{ marginLeft: 20 }}>
          Room: <strong>{currentRoom || "None"}</strong>
        </span>
        <span style={{ marginLeft: 20 }}>
          Sync Status: <strong>{syncStatus}</strong>
        </span>
      </div>

      <div className="controls">
        <input type="text" id="roomId" placeholder="Enter room ID" />
        <button onClick={() => joinRoom(setCurrentRoom)}>Join Room</button>
        <input type="text" id="videoId" placeholder="YouTube Video ID" />
        <button onClick={() => loadVideo(player, currentRoom)}>
          Load Video
        </button>
        <button onClick={() => requestSync(currentRoom)}>Force Sync</button>
      </div>

      <div id="player"></div>
    </div>
  );
};

export default App;

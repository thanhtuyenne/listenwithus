import React, { useState, useEffect } from "react";
import {
  initializeYouTubePlayer,
  joinRoom,
  leaveRoom,
  loadVideo,
  requestSync,
  socket,
} from "./main";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faEarthAfrica,
  faHome,
  faRotate,
} from "@fortawesome/free-solid-svg-icons";
import { Toaster } from "react-hot-toast";

declare const YT: any;

const App = () => {
  const [player, setPlayer] = useState<any>(null);
  const [currentRoom, setCurrentRoom] = useState<string | null>(null);
  const [lastUpdateTime, setLastUpdateTime] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState("Disconnected");
  const [syncStatus, setSyncStatus] = useState("Not synced");

  useEffect(() => {
    initializeYouTubePlayer(setPlayer, setConnectionStatus, setSyncStatus);

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
    <div className="relative">
      <h1 className="text-green-500 text-center font-bold text-3xl font-quickSand py-4">
        LISTEN WITH US
      </h1>
      {currentRoom && (
        <div
          onClick={() =>
            leaveRoom(currentRoom, setCurrentRoom, setConnectionStatus)
          }
          className="flex gap-2 items-center text-red-400 font-bold cursor-pointer absolute top-5 left-2 text-sm"
        >
          <FontAwesomeIcon icon={faArrowLeft} size="1x" />
          <span>LEAVE THE ROOM</span>
        </div>
      )}
      <div className="flex items-center flex-row-reverse justify-between mx-2">
        <div className="status-bar flex justify-between w-[450px] float-end px-4">
          <span>
            <FontAwesomeIcon icon={faEarthAfrica} />{" "}
            <strong
              className={connectionStatus ? "text-green-400" : "text-red-400"}
            >
              {connectionStatus}
            </strong>
          </span>
          <span>
            <FontAwesomeIcon icon={faHome} />{" "}
            <strong
              className={currentRoom ? "text-green-400" : "text-gray-400"}
            >
              {currentRoom || "None"}
            </strong>
          </span>
          <span>
            <FontAwesomeIcon icon={faRotate} />{" "}
            <strong className={syncStatus ? "text-black" : "text-gray-400"}>
              {syncStatus}
            </strong>
          </span>
        </div>

        <div className="controls my-4">
          {!currentRoom && (
            <div className="flex gap-2">
              <input
                className="h-[38px] w-[200px] border rounded-md border-green-400 py-1 px-2 outline-none focus:border-green-500 focus:border-2 transition-[0.35s]"
                type="text"
                id="roomId"
                placeholder="Enter room ID"
              />
              <button
                className="bg-green-400 border-green-400 border-1 text-white rounded-md px-2 py-1 hover:bg-green-500 transition-[0.5s]"
                onClick={() => joinRoom(setCurrentRoom)}
              >
                Join Room
              </button>
            </div>
          )}
          {currentRoom && (
            <>
              <div className="flex gap-2">
                <input
                  className="h-[38px] w-[200px] border rounded-md border-green-400 py-1 px-2 outline-none focus:border-green-500 focus:border-2 transition-[0.35s]"
                  type="text"
                  id="videoId"
                  placeholder="YouTube Video ID"
                />
                <button
                  className="bg-green-400 border-green-400 border-1 text-white rounded-md px-2 py-1 hover:bg-green-500 transition-[0.5s]"
                  onClick={() => loadVideo(player, currentRoom)}
                >
                  Load Video
                </button>
                <button
                  className="bg-cyan-950 border-cyan-400 border-1 text-white rounded-md px-2 py-1 transition-[0.5s]"
                  onClick={() => requestSync(currentRoom)}
                >
                  Force Sync
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      <Toaster />

      <div className="flex place-self-center">
        {" "}
        <div id="player"></div>
      </div>
    </div>
  );
};

export default App;

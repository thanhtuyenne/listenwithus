import React, { useEffect, useRef, useState } from "react";

type YouTubeIframeManagerProps = {
  videoId: string;
};

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

const YouTubeIframeManager: React.FC<YouTubeIframeManagerProps> = ({ videoId }) => {
  const iframeRef = useRef<HTMLDivElement | null>(null);
  const [player, setPlayer] = useState<any>(null);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);

  useEffect(() => {
    // Load YouTube Iframe API script dynamically
    const scriptTag = document.createElement("script");
    scriptTag.src = "https://www.youtube.com/iframe_api";
    scriptTag.async = true;
    document.body.appendChild(scriptTag);

    // Initialize YouTube player after API loads
    window.onYouTubeIframeAPIReady = () => {
      if (iframeRef.current) {
        const newPlayer = new window.YT.Player(iframeRef.current, {
          height: "390",
          width: "640",
          videoId: videoId,
          events: {
            onReady: () => setIsLoaded(true),
            onStateChange: (event: any) => console.log("Player State Changed:", event.data),
          },
        });
        setPlayer(newPlayer);
      }
    };

    return () => {
      // Cleanup the script and player
      if (player) player.destroy();
      document.body.removeChild(scriptTag);
    };
  }, [videoId, player]);

  const playVideo = () => player?.playVideo();
  const pauseVideo = () => player?.pauseVideo();
  const loadVideoById = (id: string) => player?.loadVideoById(id);

  return (
    <div className="flex flex-col items-center">
      <div ref={iframeRef} />

      {isLoaded && (
        <div className="flex space-x-2 mt-4">
          <button onClick={playVideo}>Play</button>
          <button onClick={pauseVideo}>Pause</button>
          <button
            onClick={() => {
              const id = prompt("Enter a YouTube Video ID:", "dQw4w9WgXcQ");
              if (id) loadVideoById(id);
            }}
          >
            Load Video by ID
          </button>
        </div>
      )}
    </div>
  );
};

export default YouTubeIframeManager;

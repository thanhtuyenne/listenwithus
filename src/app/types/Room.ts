// types/Room.ts
export interface Room {
    id: string;
    name: string;
    host: string; // user ID of the host
    participants: string[]; // array of user IDs
    videoQueue: string[]; // array of video IDs
    currentVideo: string | null; // ID of the current video
    playbackState: "playing" | "paused"; // playback state
    timestamp: number; // current video timestamp in seconds
  }
  
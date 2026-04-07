"use client";
// context/RoomContext.tsx
import React, { createContext, useContext, useState, ReactNode } from "react";
import { Room } from "../types/Room";
import socket from "@/app/lib/socket-room";

interface RoomContextType {
  room: Room ;
  setRoom: (room: Room ) => void;
  updateRoomData: (updates: Partial<Room>) => void;
}

const RoomContext = createContext<RoomContextType | undefined>(undefined);

export const RoomProvider = ({ children }: { children: ReactNode }) => {
  const [room, setRoom] = useState<Room>(
    {
      id: "",
    name: "",
    host: "", // user ID of the host
    participants: [], // array of user IDs
    videoQueue: [], // array of video IDs
    currentVideo: null, // ID of the current video
    playbackState: "paused", // playback state
    timestamp: 0 // current video timestamp in seconds
    }
  );

  const updateRoomData = (updates: Partial<Room>) => {
    setRoom((prev) => ({ ...prev, ...updates }));
  };

  return (
    <RoomContext.Provider value={{ room, setRoom, updateRoomData }}>
      {children}
    </RoomContext.Provider>
  );
};

export const useRoom = (): RoomContextType => {
  const context = useContext(RoomContext);
  if (!context) {
    throw new Error("useRoom must be used within a RoomProvider");
  }
  return context;
};

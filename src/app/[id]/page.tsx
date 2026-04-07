"use client"
import { useParams } from "next/navigation";
import socket from "@/app/lib/socket-room";
import { useRoom } from "../context/RoomContext";
import YouTubeIframeManager from "@/app/lib/components/YouTubeIframeManager";
import { useEffect } from "react";
declare const YT: any;

export default function RoomPage() {
  
  const params = useParams();
  const { room, updateRoomData } = useRoom();

  const id = params?.id as string;
  useEffect(()=>{
    updateRoomData({id}); 
  },[id])
  // Socket connection handlers
  socket.on("connect", () => {
    console.log("Connected");
  });
  socket.on("disconnect", () => {
    console.log("Disconnected");
  });
  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-4">YouTube Iframe API Manager RoomId:{room?.id}</h1>
      {room?.id&&<YouTubeIframeManager videoId={room.currentVideo!} />}
    </div>
  );
}

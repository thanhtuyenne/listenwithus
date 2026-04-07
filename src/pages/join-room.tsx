import { useState } from 'react';
import { useRouter } from 'next/router';

export default function JoinRoom() {
  const [roomCode, setRoomCode] = useState<string>('');
  const router = useRouter();

  const joinRoom = () => {
    router.push(`/room/${roomCode}`);
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen">
      <input
        type="text"
        placeholder="Enter Room Code"
        value={roomCode}
        onChange={(e) => setRoomCode(e.target.value)}
        className="border p-2 mb-2"
      />
      <button onClick={joinRoom} className="bg-blue-500 text-white p-2 rounded">
        Join Room
      </button>
    </div>
  );
}
import { useState } from 'react';
import { useRouter } from 'next/router';
import { db } from '@/app/lib/firebase';
import { collection, addDoc } from 'firebase/firestore';

export default function CreateRoom() {
  const router = useRouter();

  const createRoom = async () => {
    const roomRef = await addDoc(collection(db, 'rooms'), {
      code: Math.random().toString(36).substring(7),
      videoId: '',
      queue: [],
    });
    router.push(`/room/${roomRef.id}`);
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen">
      <button onClick={createRoom} className="bg-blue-500 text-white p-2 rounded">
        Create Room
      </button>
    </div>
  );
}
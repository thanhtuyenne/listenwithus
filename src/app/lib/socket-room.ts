"use client";

import { io, Socket } from "socket.io-client";

const socket: Socket = io({
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  transports: ["websocket"],
  autoConnect: false, // Don't connect until the server is initialized
});

export default socket;

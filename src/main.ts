import { io } from 'socket.io-client';
import toast from 'react-hot-toast';

export const socket = io({
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
});

export function initializeYouTubePlayer(
    setPlayer: (player: any) => void,
    setConnectionStatus: (status: string) => void,
    setSyncStatus: (status: string) => void
) {
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);

    (window as any).onYouTubeIframeAPIReady = () => {
        const player = new (window as any).YT.Player('player', {
            height: '360',
            width: '640',
            playerVars: {
                enablejsapi: 1,
                playsinline: 1,
                origin: window.location.origin,
            },
            events: {
                onReady: () => {
                    console.log('Player ready');
                    setPlayer(player);
                },
                onStateChange: (event: any) => handlePlayerStateChange(event, player),
                onError: (event: any) => toast.error(`Video player error: ${event.data}`),
            },
        });

        setPlayer(player);
    };

    // Socket connection handlers
    socket.on('connect', () => setConnectionStatus('Connected'));
    socket.on('disconnect', () => setConnectionStatus('Disconnected'));

    // Video sync handlers
    socket.on('videoStateUpdate', (data: any) =>
        syncPlayerState(data, setSyncStatus)
    );
    socket.on('syncState', (data: any) =>
        syncPlayerState(data, setSyncStatus)
    );
}

function handlePlayerStateChange(event: any, player: any) {
    const isSyncUpdate = false; // Sync updates are handled separately
    if (isSyncUpdate) return;

    const videoId = player.getVideoData().video_id;
    const timestamp = player.getCurrentTime();
    const isPlaying = event.data === (window as any).YT.PlayerState.PLAYING;

    emitVideoState(videoId, timestamp, isPlaying);
}


export function joinRoom(setCurrentRoom: (room: string) => void) {
    const roomId = (document.getElementById('roomId') as HTMLInputElement).value.trim();
    if (!roomId) {
        toast.error('Please enter a room ID');
        return;
    }

    setCurrentRoom(roomId);
    socket.emit('joinRoom', roomId);
    toast.success("Join room successfully");
}

export function leaveRoom(
    currentRoom: string | null,
    setCurrentRoom: (room: string | null) => void,
    setConnectionStatus: (status: string) => void
) {
    if (!currentRoom) {
        toast.error('You are not in any room');
        return;
    }

    socket.emit('leaveRoom', currentRoom, () => {
        setCurrentRoom(null);
        setConnectionStatus('Disconnected');
        toast.success('You have left the room');
    });
}


export function loadVideo(player: any, currentRoom: string | null) {
    const videoId = (document.getElementById('videoId') as HTMLInputElement).value.trim();
    if (!videoId || !currentRoom) {
        toast.error('Please enter video ID and join a room first');
        return;
    }

    player.loadVideoById(videoId);
    emitVideoState(videoId, 0, true);
}

export function requestSync(
    currentRoom: string | null,
    videoId?: string,
    timestamp?: number,
    isPlaying?: boolean
) {
    if (!currentRoom) return;

    socket.emit('requestSync', currentRoom);

    if (videoId !== undefined && timestamp !== undefined && isPlaying !== undefined) {
        emitVideoState(videoId, timestamp, isPlaying);
    }
}

function emitVideoState(videoId: string, timestamp: number, isPlaying: boolean) {
    socket.emit('videoUpdate', { videoId, timestamp, isPlaying });
}

function syncPlayerState(
    data: any,
    setSyncStatus: (status: string) => void
) {
    setSyncStatus('Syncing...');

    const player = (window as any).player;
    if (!player) return;

    const currentTime = player.getCurrentTime();
    const timeDiff = Math.abs(currentTime - data.timestamp);

    if (data.videoId !== player.getVideoData().video_id) {
        player.loadVideoById(data.videoId, data.timestamp);
    } else if (timeDiff > 2) {
        player.seekTo(data.timestamp);
    }

    if (data.isPlaying) {
        player.playVideo();
    } else {
        player.pauseVideo();
    }

    setTimeout(() => setSyncStatus('Synced'), 1000);
}

import { useEffect } from 'react';
import { useSocket as useSocketContext } from '../context/SocketContext';

/**
 * Subscribe a handler to a Socket.IO event with automatic cleanup.
 *
 * @param event - socket event name
 * @param handler - callback invoked for every payload
 */
export function useSocketEvent<T = unknown>(event: string, handler: (payload: T) => void) {
  const { socket } = useSocketContext();
  useEffect(() => {
    if (!socket) return;
    socket.on(event, handler);
    return () => {
      socket.off(event, handler);
    };
  }, [socket, event, handler]);
}

export { useSocketContext as useSocket };

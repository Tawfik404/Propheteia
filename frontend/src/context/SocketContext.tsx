import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { Socket } from 'socket.io-client';
import type { SocketStatus } from '../types';
import { socketClient } from '../services/socket';

interface SocketContextType {
  status: SocketStatus;
  socket: Socket | null;
  /** Subscribe the connection to a monitored area (no-op until connected). */
  setMonitoredArea: (lat: number, lon: number) => void;
  /** Leave all monitored areas. */
  clearMonitoredArea: () => void;
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

export function SocketProvider({ children }: { children: ReactNode }) {
  // Lazy init: connects once and reuses the shared singleton.
  const [socket] = useState<Socket | null>(() => socketClient.getSocket());
  const [status, setStatus] = useState<SocketStatus>(socketClient.getStatus());

  useEffect(() => {
    const unsubscribe = socketClient.onStatusChange(setStatus);
    return () => {
      unsubscribe();
    };
  }, []);

  const setMonitoredArea = (lat: number, lon: number) => {
    socketClient.setMonitoredArea(lat, lon);
  };

  const clearMonitoredArea = () => {
    socketClient.clearMonitoredArea();
  };

  return (
    <SocketContext.Provider value={{ status, socket, setMonitoredArea, clearMonitoredArea }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocket must be used within SocketProvider');
  return ctx;
}

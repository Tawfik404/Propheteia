import { io, type Socket } from 'socket.io-client';
import type { SocketStatus } from '../types';

/**
 * Socket.IO client wrapper.
 *
 * A single lazily-created singleton drives the real-time channel for the
 * whole app. It tracks the connection status for the UI badge, reconnects
 * automatically (socket.io default), and lets the app subscribe/unsubscribe
 * to a monitored area as the user moves.
 */
export class SocketClient {
  private socket: Socket | null = null;
  private listeners = new Set<(status: SocketStatus) => void>();
  private status: SocketStatus = 'connecting';
  private lastView: {
    north: number;
    south: number;
    east: number;
    west: number;
    zoom: number;
  } | null = null;

  /** Connect once; returns the shared socket instance. */
  connect(): Socket {
    if (this.socket) return this.socket;

    const socket = io({
      path: '/socket.io',
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 10000,
    });

    socket.on('connect', () => {
      this.setStatus('connected');
      // Re-apply the latest viewport subscription after a reconnect.
      if (this.lastView) socket.emit('subscribe:view', this.lastView);
    });
    socket.on('disconnect', (reason) => {
      this.setStatus(reason === 'io client disconnect' ? 'offline' : 'reconnecting');
    });
    socket.on('connect_error', () => {
      if (!socket.connected) this.setStatus('reconnecting');
    });

    this.socket = socket;
    return socket;
  }

  /** Get the socket, connecting on first use. */
  getSocket(): Socket {
    return this.connect();
  }

  /** Current connection status. */
  getStatus(): SocketStatus {
    return this.status;
  }

  /** Subscribe the current connection to real-time updates for an area. */
  setMonitoredArea(lat: number, lon: number) {
    if (!this.socket?.connected) return;
    this.socket.emit('monitor:area', { lat, lon });
  }

  /** Stop receiving area-scoped updates. */
  clearMonitoredArea() {
    if (!this.socket?.connected) return;
    this.socket.emit('unmonitor');
  }

  /** Subscribe to real-time updates for the visible map viewport. */
  subscribeView(view: {
    north: number;
    south: number;
    east: number;
    west: number;
    zoom: number;
  }) {
    this.lastView = view;
    if (!this.socket?.connected) return;
    this.socket.emit('subscribe:view', view);
  }

  /** Stop receiving viewport-scoped updates. */
  unsubscribeView() {
    this.lastView = null;
    if (!this.socket?.connected) return;
    this.socket.emit('unsubscribe:view');
  }

  /** Listen for connection status changes. Returns an unsubscribe fn. */
  onStatusChange(callback: (status: SocketStatus) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /** Explicitly disconnect (app teardown). */
  disconnect() {
    this.lastView = null;
    this.socket?.disconnect();
    this.socket = null;
    this.setStatus('offline');
  }

  private setStatus(status: SocketStatus) {
    if (this.status === status) return;
    this.status = status;
    this.listeners.forEach((listener) => listener(status));
  }
}

/** Application-wide singleton. */
export const socketClient = new SocketClient();

export default socketClient;

import { EventEmitter } from 'node:events';

/**
 * Application-wide event bus.
 *
 * Decouples the services (prediction, weather, jobs) from the transport
 * layer (Socket.IO). Services emit domain events here; the socket server
 * listens and forwards them to subscribed clients as real-time updates.
 *
 * Events:
 *   prediction:computed  { prediction }   a prediction was computed
 *   weather:refreshed    { lat, lon, weather } cached weather was refreshed
 */
export const eventBus = new EventEmitter();
eventBus.setMaxListeners(50);

export default eventBus;

import { Server as SocketServer } from 'socket.io';
import logger from '../utils/logger.js';
import { eventBus } from '../utils/eventBus.js';
import { locationKey } from '../utils/geo.js';
import { ALERT_RISK_THRESHOLD } from '../services/alerts/alerts.service.js';

/**
 * Real-time transport (Socket.IO).
 *
 * Client contract:
 *   emit  "monitor:area"     { lat, lon }           subscribe to a location's updates
 *   emit  "unmonitor"                                leave all subscribed areas
 *   emit  "subscribe:view"   { north, south, east, west, zoom }  subscribe to a map viewport
 *   emit  "unsubscribe:view"                          leave the viewport subscription
 *   hear  "connection:status" { status }              connected / reconnecting / offline
 *   hear  "area:monitored"   { key, lat, lon }
 *   hear  "prediction:updated"  { prediction }        full prediction for an area
 *   hear  "weather:updated"     { lat, lon, weather }
 *   hear  "risk:changed"      { lat, lon, previousRiskLevel, currentRiskLevel, prediction }
 *   hear  "alert:new"      { alert }                  broadcast to every client
 *   hear  "alert:resolved" { lat, lon }
 *
 * Delivery policy:
 *   - `prediction:updated`, `weather:updated` and `risk:changed` are sent
 *     only to clients that subscribed to the affected area (monitor:area)
 *     or whose viewport contains the point (subscribe:view). Clients
 *     never receive predictions for areas they are not looking at.
 *   - `alert:new` / `alert:resolved` are global (rare, and the alerts
 *     page needs them regardless of the current viewport).
 */

const GLOBAL_ROOM = 'global';

/** Risk order used to detect "risk increased / decreased". */
const RISK_RANK = {
  'Very Low': 0,
  Low: 1,
  Moderate: 2,
  High: 3,
  Extreme: 4,
};

let io = null;

/**
 * Attach Socket.IO to an HTTP server and start forwarding domain events.
 *
 * @param {import('node:http').Server} server
 * @returns {import('socket.io').Server}
 */
export function initSocket(server) {
  if (io) return io;

  io = new SocketServer(server, {
    serveClient: false,
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  io.on('connection', (socket) => {
    socket.join(GLOBAL_ROOM);
    const areas = new Set();
    logger.info(`[socket] client connected (${socket.id}), total=${io.engine.clientsCount}`);

    socket.on('monitor:area', (data = {}) => {
      const lat = Number(data.lat);
      const lon = Number(data.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

      // Leave previous areas so a moved user only gets relevant updates.
      for (const key of areas) socket.leave(`area:${key}`);
      areas.clear();

      const key = locationKey(lat, lon);
      socket.join(`area:${key}`);
      areas.add(key);
      socket.emit('area:monitored', { key, lat, lon });
    });

    socket.on('unmonitor', () => {
      for (const key of areas) socket.leave(`area:${key}`);
      areas.clear();
      socket.emit('area:unmonitored');
    });

    socket.on('subscribe:view', (view = {}) => {
      const parsed = parseView(view);
      if (!parsed) return;
      socket.data.view = parsed;
      socket.emit('view:subscribed', parsed);
    });

    socket.on('unsubscribe:view', () => {
      delete socket.data.view;
      socket.emit('view:unsubscribed');
    });

    socket.on('disconnect', (reason) => {
      delete socket.data.view;
      logger.info(`[socket] client disconnected (${socket.id}) reason=${reason}`);
    });
  });

  eventBus.on('prediction:computed', forwardPrediction);
  eventBus.on('weather:refreshed', forwardWeatherRefresh);
  eventBus.on('prediction:renamed', forwardRename);

  logger.info('[socket] real-time server attached');
  return io;
}

/**
 * Validate a viewport subscription payload.
 *
 * @param {object} view
 * @returns {{north:number,south:number,east:number,west:number,zoom:number}|null}
 */
function parseView(view) {
  const north = Number(view?.north);
  const south = Number(view?.south);
  const east = Number(view?.east);
  const west = Number(view?.west);
  if (
    ![north, south, east, west].every(Number.isFinite) ||
    north <= south ||
    east <= west ||
    north > 90 ||
    south < -90 ||
    east > 180 ||
    west < -180
  ) {
    return null;
  }
  const zoom = Number.isFinite(Number(view?.zoom)) ? Number(view.zoom) : 4;
  return { north, south, east, west, zoom };
}

/**
 * Whether a viewport contains a point (antimeridian-ignoring, clamped).
 *
 * @param {{north:number,south:number,east:number,west:number}} view
 * @param {number} lat
 * @param {number} lon
 * @returns {boolean}
 */
function viewContains(view, lat, lon) {
  return lat <= view.north && lat >= view.south && lon >= view.west && lon <= view.east;
}

/**
 * Forward an event to every socket whose subscribed viewport contains the
 * point (plus the area room, delivered by the caller when needed).
 *
 * @param {number} lat
 * @param {number} lon
 * @param {string} event
 * @param {object} payload
 */
function emitToViewport(lat, lon, event, payload) {
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data?.view && viewContains(socket.data.view, lat, lon)) {
      socket.emit(event, payload);
    }
  }
}

/**
 * Forward a freshly computed prediction to subscribers.
 *
 * @param {{ prediction: object, previousRiskLevel: string|null }} payload
 */
function forwardPrediction({ prediction, previousRiskLevel }) {
  if (!io) return;

  const { latitude: lat, longitude: lon } = prediction;
  const key = locationKey(lat, lon);
  const room = `area:${key}`;

  // Viewport subscribers (the map) and the monitored area's subscribers.
  emitToViewport(lat, lon, 'prediction:updated', prediction);
  io.to(room).emit('prediction:updated', prediction);

  const weather = { lat, lon, weather: prediction.weather };
  emitToViewport(lat, lon, 'weather:updated', weather);
  io.to(room).emit('weather:updated', weather);

  const currentRisk = prediction.riskLevel;
  if (currentRisk !== previousRiskLevel && previousRiskLevel) {
    const riskPayload = {
      lat,
      lon,
      previousRiskLevel,
      currentRiskLevel: currentRisk,
      prediction,
    };
    emitToViewport(lat, lon, 'risk:changed', riskPayload);
    io.to(room).emit('risk:changed', riskPayload);
  }

  const alert = toAlertEvent(prediction);
  const crossedUp = isActionable(currentRisk) && !isActionable(previousRiskLevel);
  const crossedDown = !isActionable(currentRisk) && isActionable(previousRiskLevel);

  // Alert transitions are global: the alerts page shows them regardless
  // of the current map viewport.
  if (crossedUp) {
    io.to(GLOBAL_ROOM).emit('alert:new', alert);
  }
  if (crossedDown) {
    io.to(GLOBAL_ROOM).emit('alert:resolved', { lat, lon, riskLevel: currentRisk });
  }
}

/**
 * Forward a background weather refresh to the affected area.
 *
 * @param {object} payload - { lat, lon, weather }
 */
function forwardWeatherRefresh({ lat, lon, weather }) {
  if (!io) return;
  emitToViewport(lat, lon, 'weather:updated', { lat, lon, weather });
  io.to(`area:${locationKey(lat, lon)}`).emit('weather:updated', { lat, lon, weather });
}

/**
 * Forward a reverse-geocoded name to clients looking at that point.
 *
 * Names resolve asynchronously after a prediction is computed, so this
 * lets open markers/info panels upgrade from "lat, lon" to a real place
 * name without waiting for the next region refresh.
 *
 * @param {object} payload - { lat, lon, name }
 */
function forwardRename({ lat, lon, name }) {
  if (!io) return;
  const payload = { lat, lon, name };
  emitToViewport(lat, lon, 'prediction:renamed', payload);
  io.to(`area:${locationKey(lat, lon)}`).emit('prediction:renamed', payload);
}

/**
 * Whether a risk level qualifies as an actionable alert.
 *
 * @param {string} [riskLevel]
 * @returns {boolean}
 */
function isActionable(riskLevel) {
  return (RISK_RANK[riskLevel] ?? 0) >= RISK_RANK[ALERT_RISK_THRESHOLD];
}

/**
 * Alert-shaped payload derived from a prediction.
 *
 * @param {object} prediction
 * @returns {object}
 */
function toAlertEvent(prediction) {
  const name = prediction.name ?? null;
  const parts = name ? name.split(',').map((p) => p.trim()) : [];
  return {
    id: locationKey(prediction.latitude, prediction.longitude),
    lat: prediction.latitude,
    lon: prediction.longitude,
    location: name ?? 'Unknown area',
    country: parts.length >= 2 ? parts[parts.length - 1] : null,
    region: parts.length >= 2 ? parts[0] : null,
    riskLevel: prediction.riskLevel,
    fireProbability: prediction.fireProbability,
    fwi: prediction.indices.FWI,
    timestamp: prediction.predictedAt,
  };
}

/**
 * Close the real-time server (graceful shutdown).
 */
export function closeSocket() {
  if (!io) return;
  eventBus.off('prediction:computed', forwardPrediction);
  eventBus.off('weather:refreshed', forwardWeatherRefresh);
  eventBus.off('prediction:renamed', forwardRename);
  io.close();
  io = null;
  logger.info('[socket] real-time server closed');
}

export default { initSocket, closeSocket };

import { Server as SocketServer } from 'socket.io';
import logger from '../utils/logger.js';
import { eventBus } from '../utils/eventBus.js';
import { locationKey } from '../utils/geo.js';
import { ALERT_RISK_THRESHOLD } from '../services/alerts/alerts.service.js';

/**
 * Real-time transport (Socket.IO).
 *
 * Client contract:
 *   emit  "monitor:area"  { lat, lon }          subscribe to a location's updates
 *   emit  "unmonitor"                            leave all subscribed areas
 *   hear  "connection:status" { status }         connected / reconnecting / offline
 *   hear  "prediction:updated"  { prediction }   full prediction for an area
 *   hear  "weather:updated"     { lat, lon, weather }
 *   hear  "alert:new"      { alert }
 *   hear  "alert:resolved" { lat, lon }
 *   hear  "risk:changed"   { lat, lon, previousRiskLevel, currentRiskLevel, prediction }
 *
 * Every client joins the "global" room on connect, so prediction/alert
 * broadcasts reach everyone; area rooms scope updates to monitored spots.
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

    socket.on('disconnect', (reason) => {
      logger.info(`[socket] client disconnected (${socket.id}) reason=${reason}`);
    });
  });

  eventBus.on('prediction:computed', forwardPrediction);
  eventBus.on('weather:refreshed', forwardWeatherRefresh);

  logger.info('[socket] real-time server attached');
  return io;
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

  io.to(GLOBAL_ROOM).emit('prediction:updated', prediction);

  const weather = { lat, lon, weather: prediction.weather };
  io.to(GLOBAL_ROOM).emit('weather:updated', weather);

  const currentRisk = prediction.riskLevel;
  if (currentRisk !== previousRiskLevel && previousRiskLevel) {
    const riskPayload = {
      lat,
      lon,
      previousRiskLevel,
      currentRiskLevel: currentRisk,
      prediction,
    };
    io.to(GLOBAL_ROOM).emit('risk:changed', riskPayload);
    io.to(room).emit('risk:changed', riskPayload);
  }

  const alert = toAlertEvent(prediction);
  const crossedUp = isActionable(currentRisk) && !isActionable(previousRiskLevel);
  const crossedDown = !isActionable(currentRisk) && isActionable(previousRiskLevel);

  if (crossedUp) {
    io.to(GLOBAL_ROOM).emit('alert:new', alert);
  }
  if (crossedDown) {
    io.to(GLOBAL_ROOM).emit('alert:resolved', { lat, lon, riskLevel: currentRisk });
  }

  // Area-scoped subscribers get the fine-grained updates.
  io.to(room).emit('prediction:updated', prediction);
  io.to(room).emit('weather:updated', weather);
  if (crossedUp) io.to(room).emit('alert:new', alert);
  if (crossedDown) io.to(room).emit('alert:resolved', { lat, lon, riskLevel: currentRisk });
}

/**
 * Forward a background weather refresh to the affected area.
 *
 * @param {object} payload - { lat, lon, weather }
 */
function forwardWeatherRefresh({ lat, lon, weather }) {
  if (!io) return;
  io.to(GLOBAL_ROOM).emit('weather:updated', { lat, lon, weather });
  io.to(`area:${locationKey(lat, lon)}`).emit('weather:updated', { lat, lon, weather });
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
  io.close();
  io = null;
  logger.info('[socket] real-time server closed');
}

export default { initSocket, closeSocket };

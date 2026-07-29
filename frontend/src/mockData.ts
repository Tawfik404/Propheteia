import type { Alert, GlobalPrediction, MapMarker, MapInfo } from './types';

export const nearbyAlerts: Alert[] = [
  {
    id: '1',
    riskLevel: 'High',
    location: 'Northern Forest Area',
    time: 'Prediction in 2 hours',
    description: 'High temperature and strong winds detected.',
  },
  {
    id: '2',
    riskLevel: 'Medium',
    location: 'Eastern Ridge',
    time: 'Prediction in 6 hours',
    description: 'Rising temperatures and low humidity expected.',
  },
  {
    id: '3',
    riskLevel: 'Low',
    location: 'Valley Creek',
    time: 'Prediction in 24 hours',
    description: 'Slight increase in temperature, minimal risk.',
  },
  {
    id: '4',
    riskLevel: 'High',
    location: 'Western Plains',
    time: 'Prediction in 1 hour',
    description: 'Extreme heat and dry conditions forecasted.',
  },
];

export const globalPredictions: GlobalPrediction[] = [
  { id: 'g1', country: 'Canada', region: 'British Columbia', riskPercentage: 82 },
  { id: 'g2', country: 'United States', region: 'California', riskPercentage: 76 },
  { id: 'g3', country: 'Australia', region: 'New South Wales', riskPercentage: 64 },
  { id: 'g4', country: 'Portugal', region: 'Coimbra', riskPercentage: 55 },
  { id: 'g5', country: 'Greece', region: 'Attica', riskPercentage: 71 },
  { id: 'g6', country: 'Chile', region: 'Valparaíso', riskPercentage: 43 },
  { id: 'g7', country: 'Spain', region: 'Andalusia', riskPercentage: 68 },
  { id: 'g8', country: 'Brazil', region: 'Mato Grosso', riskPercentage: 59 },
];

export const mapMarkers: MapMarker[] = [
  { id: 'm1', lat: 40.7128, lng: -74.006, riskLevel: 'High', location: 'New York' },
  { id: 'm2', lat: 34.0522, lng: -118.2437, riskLevel: 'High', location: 'Los Angeles' },
  { id: 'm3', lat: 51.5074, lng: -0.1278, riskLevel: 'Medium', location: 'London' },
  { id: 'm4', lat: 48.8566, lng: 2.3522, riskLevel: 'Low', location: 'Paris' },
  { id: 'm5', lat: 35.6762, lng: 139.6503, riskLevel: 'Medium', location: 'Tokyo' },
  { id: 'm6', lat: -33.8688, lng: 151.2093, riskLevel: 'High', location: 'Sydney' },
  { id: 'm7', lat: 55.7558, lng: 37.6173, riskLevel: 'Low', location: 'Moscow' },
  { id: 'm8', lat: 19.076, lng: 72.8777, riskLevel: 'Medium', location: 'Mumbai' },
  { id: 'm9', lat: 49.2827, lng: -123.1207, riskLevel: 'High', location: 'Vancouver' },
  { id: 'm10', lat: 41.9028, lng: 12.4964, riskLevel: 'Low', location: 'Rome' },
];

export const defaultMapInfo: MapInfo = {
  location: 'Northern Forest Area',
  probability: 72,
  temperature: 38,
  humidity: 18,
  windSpeed: 45,
  confidence: 85,
};

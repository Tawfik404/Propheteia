export type RiskLevel = 'Very Low' | 'Low' | 'Moderate' | 'High' | 'Extreme';
export type ThemeMode = 'light' | 'dark';
export type SocketStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';
export type LocationStatus = 'idle' | 'prompting' | 'granted' | 'denied' | 'unavailable';

/** Weather block returned by the backend (normalized provider payload). */
export interface WeatherData {
  temperature: number;
  humidity: number;
  windSpeed: number;
  precipitation: number;
  rainfall24h: number;
  weatherCode: number | null;
  observedAt: string;
  provider: string;
  cached: boolean;
}

/** The six official Canadian FWI System indices. */
export interface FwiIndices {
  FFMC: number;
  DMC: number;
  DC: number;
  ISI: number;
  BUI: number;
  FWI: number;
  DSR: number;
}

/** Full prediction payload served by GET /api/predict and the socket. */
export interface Prediction {
  latitude: number;
  longitude: number;
  predictedAt: string;
  name: string | null;
  weather: WeatherData;
  indices: FwiIndices;
  riskLevel: RiskLevel;
  fireProbability: number;
  state: {
    date: string;
    previousDate: string | null;
    usedStartupValues: boolean;
  };
}

/** Alert-shaped prediction (nearby + global lists, socket alert events). */
export interface Alert {
  id: string;
  lat: number;
  lon: number;
  location: string;
  country: string | null;
  region: string | null;
  riskLevel: RiskLevel;
  fireProbability: number;
  fwi: number;
  timestamp: string;
  distanceKm?: number;
  resolved?: boolean;
  isNew?: boolean;
}

/** Map marker derived from a prediction. */
export interface MapMarkerData {
  id: string;
  lat: number;
  lng: number;
  riskLevel: RiskLevel;
  location: string;
  prediction: Prediction;
}

/** Info panel contents for the selected location. */
export interface MapInfo {
  location: string;
  riskLevel: RiskLevel;
  probability: number;
  fwi: number;
  temperature: number;
  humidity: number;
  windSpeed: number;
  lastUpdated: string;
}

/** Live risk change received over the socket. */
export interface RiskChange {
  lat: number;
  lon: number;
  previousRiskLevel: RiskLevel;
  currentRiskLevel: RiskLevel;
  prediction: Prediction;
}

/** Persisted user preferences. */
export interface SettingsState {
  notifications: boolean;
  location: boolean;
}

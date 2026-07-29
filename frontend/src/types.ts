export type RiskLevel = 'Low' | 'Medium' | 'High';
export type ThemeMode = 'light' | 'dark';

export interface Alert {
  id: string;
  riskLevel: RiskLevel;
  location: string;
  time: string;
  description: string;
}

export interface GlobalPrediction {
  id: string;
  country: string;
  region: string;
  riskPercentage: number;
}

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  riskLevel: RiskLevel;
  location: string;
}

export interface MapInfo {
  location: string;
  probability: number;
  temperature: number;
  humidity: number;
  windSpeed: number;
  confidence: number;
}

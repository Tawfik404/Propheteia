import { useState } from 'react';
import { Globe, MapPin, WifiOff } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import AlertCard from '../components/AlertCard';
import ConnectionStatus from '../components/ConnectionStatus';
import { useAlerts } from '../hooks/useAlerts';
import { useLocation } from '../hooks/useLocation';
import { useSettings } from '../context/SettingsContext';
import { useSocketEvent } from '../hooks/useSocket';
import type { RiskChange } from '../types';
import { showNotification } from '../services/notifications';

export default function Alerts() {
  const [showAll, setShowAll] = useState(false);
  const { settings } = useSettings();
  const location = useLocation();
  const reference = location.coords ?? null;

  const { nearby, global, loading, error } = useAlerts(reference);

  // When the user's own risk increases, surface it immediately (browser
  // notification when enabled).
  useSocketEvent<RiskChange>('risk:changed', (change) => {
    if (!reference || !settings.notifications) return;
    const isOwnArea =
      Math.abs(change.lat - reference.lat) < 1 && Math.abs(change.lon - reference.lon) < 1;
    if (isOwnArea) {
      showNotification(
        'Wildfire risk increased',
        `${change.previousRiskLevel} → ${change.currentRiskLevel} risk at your location.`
      );
    }
  });

  const visible = showAll ? global : global.slice(0, 4);

  if (loading && nearby.length === 0 && global.length === 0) {
    return (
      <div className="page alerts-page">
        <PageHeader
          title="Alerts"
          description="Real-time wildfire risk monitoring and global predictions."
        />
        <div className="alerts-loading" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <p>Loading alerts from the prediction service…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page alerts-page">
      <PageHeader
        title="Alerts"
        description="Real-time wildfire risk monitoring and global predictions."
      />

      <ConnectionStatus />

      {error && (
        <div className="error-banner" role="alert">
          <WifiOff size={18} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {!location.enabled && nearby.length === 0 && (
        <div className="location-banner" role="note">
          <MapPin size={18} aria-hidden="true" />
          <div>
            <strong>Location access is off.</strong>
            <span>
              Enable it in Settings to see nearby alerts — or keep browsing global predictions.
            </span>
          </div>
          <button
            type="button"
            className="location-banner-btn"
            onClick={location.enableLocation}
          >
            Enable location
          </button>
        </div>
      )}

      <section className="alerts-section">
        <div className="alerts-section-header">
          <div className="alerts-section-title-row">
            <MapPin size={22} />
            <h2>Nearby Wildfire Alerts</h2>
          </div>
          <p className="alerts-section-desc">
            {location.coords
              ? 'Recent and upcoming wildfire risks near your current location.'
              : 'Wildfire risks in your monitored area.'}
          </p>
        </div>
        {nearby.length === 0 ? (
          <p className="alerts-empty" role="status">
            No nearby alerts right now. When a prediction near you crosses the High risk
            threshold it will appear here in real time.
          </p>
        ) : (
          <div className="alert-cards-grid">
            {nearby.map((alert) => (
              <AlertCard key={alert.id} alert={alert} />
            ))}
          </div>
        )}
      </section>

      <section className="alerts-section">
        <div className="alerts-section-header">
          <div className="alerts-section-title-row">
            <Globe size={22} />
            <h2>Global Predictions</h2>
          </div>
        </div>
        <div className="global-list">
          {visible.map((p) => (
            <div key={p.id} className="global-card">
              <div className="global-card-left">
                <span className="global-card-country">{p.country ?? p.location}</span>
                <span className="global-card-region">
                  {p.region ? `${p.region} · ${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}` : `${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}`}
                </span>
              </div>
              <div className="global-card-right">
                <span
                  className="global-card-risk"
                  style={{
                    color:
                      p.fireProbability >= 70
                        ? '#AB3130'
                        : p.fireProbability >= 50
                          ? '#C77B14'
                          : p.fireProbability >= 40
                            ? '#7A6B3F'
                            : '#4F7B58',
                  }}
                >
                  {p.fireProbability}%
                </span>
                <span className="global-card-category">{p.riskLevel}</span>
              </div>
            </div>
          ))}
        </div>
        {global.length > 4 && (
          <button
            className="global-show-btn"
            onClick={() => setShowAll(!showAll)}
            type="button"
            aria-label={showAll ? 'Show fewer predictions' : 'Show all predictions'}
          >
            {showAll ? 'Show fewer' : `Show all (${global.length})`}
          </button>
        )}
      </section>
    </div>
  );
}

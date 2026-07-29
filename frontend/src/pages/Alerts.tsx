import { useState } from 'react';
import { Globe, MapPin } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import AlertCard from '../components/AlertCard';
import { nearbyAlerts, globalPredictions } from '../mockData';

export default function Alerts() {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? globalPredictions : globalPredictions.slice(0, 4);

  return (
    <div className="page alerts-page">
      <PageHeader
        title="Alerts"
        description="Real-time wildfire risk monitoring and global predictions."
      />

      <section className="alerts-section">
        <div className="alerts-section-header">
          <div className="alerts-section-title-row">
            <MapPin size={22} />
            <h2>Nearby Wildfire Alerts</h2>
          </div>
          <p className="alerts-section-desc">
            Recent and upcoming wildfire risks near your current location.
          </p>
        </div>
        <div className="alert-cards-grid">
          {nearbyAlerts.map(alert => (
            <AlertCard key={alert.id} alert={alert} />
          ))}
        </div>
      </section>

      <section className="alerts-section">
        <div className="alerts-section-header">
          <div className="alerts-section-title-row">
            <Globe size={22} />
            <h2>Global Predictions</h2>
          </div>
        </div>
        <div className="global-list">
          {visible.map(p => (
            <div key={p.id} className="global-card">
              <div className="global-card-left">
                <span className="global-card-country">{p.country}</span>
                <span className="global-card-region">{p.region}</span>
              </div>
              <div className="global-card-right">
                <span
                  className="global-card-risk"
                  style={{
                    color: p.riskPercentage >= 70 ? '#AB3130' : p.riskPercentage >= 50 ? '#7A6B3F' : '#4F7B58',
                  }}
                >
                  {p.riskPercentage}%
                </span>
              </div>
            </div>
          ))}
        </div>
        {globalPredictions.length > 4 && (
          <button
            className="global-show-btn"
            onClick={() => setShowAll(!showAll)}
            type="button"
            aria-label={showAll ? 'Show fewer predictions' : 'Show all predictions'}
          >
            {showAll ? 'Show fewer' : `Show all (${globalPredictions.length})`}
          </button>
        )}
      </section>
    </div>
  );
}

import { Check, Flame, MapPin } from 'lucide-react';
import RiskBadge from './RiskBadge';
import type { Alert } from '../types';

interface AlertCardProps {
  alert: Alert;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AlertCard({ alert }: AlertCardProps) {
  const { isNew, resolved } = alert;
  return (
    <article
      className={`alert-card${isNew ? ' alert-card-new' : ''}${resolved ? ' alert-card-resolved' : ''}`}
      tabIndex={0}
      aria-label={`${resolved ? 'Resolved alert' : 'Alert'} at ${alert.location}, ${alert.riskLevel} risk`}
    >
      <div className="alert-card-header">
        <div className="alert-card-title-row">
          {resolved ? (
            <Check size={20} className="alert-card-resolved-icon" aria-hidden="true" />
          ) : (
            <Flame size={20} className="alert-card-icon" aria-hidden="true" />
          )}
          <RiskBadge level={alert.riskLevel} />
        </div>
        <h3 className="alert-card-location">
          <MapPin size={14} className="alert-card-location-icon" aria-hidden="true" />
          {alert.location}
        </h3>
      </div>
      <div className="alert-card-body">
        <span className="alert-card-time">
          {resolved ? 'Resolved · ' : 'Updated · '}
          {formatTimestamp(alert.timestamp)}
          {alert.distanceKm !== undefined && alert.distanceKm > 0 && (
            <span className="alert-card-distance"> · {alert.distanceKm} km away</span>
          )}
        </span>
        <p className="alert-card-desc">
          Estimated fire probability {alert.fireProbability}% · FWI {alert.fwi}
        </p>
      </div>
    </article>
  );
}

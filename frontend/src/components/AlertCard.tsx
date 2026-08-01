import { Check, Flame, MapPin } from 'lucide-react';
import RiskBadge from './RiskBadge';
import type { Alert } from '../types';

interface AlertCardProps {
  alert: Alert;
  onClick?: () => void;
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

export default function AlertCard({ alert, onClick }: AlertCardProps) {
  const { isNew, resolved } = alert;
  const className = `alert-card${isNew ? ' alert-card-new' : ''}${resolved ? ' alert-card-resolved' : ''}${onClick ? ' alert-card-clickable' : ''}`;
  const ariaLabel = `${resolved ? 'Resolved alert' : 'Alert'} at ${alert.location}, ${alert.riskLevel} risk`;

  const content = (
    <>
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
    </>
  );

  if (!onClick) {
    return (
      <article className={className} aria-label={ariaLabel}>
        {content}
      </article>
    );
  }

  return (
    <button type="button" className={className} onClick={onClick} aria-label={ariaLabel}>
      {content}
      <span className="alert-card-view">
        <MapPin size={13} aria-hidden="true" />
        View on map
      </span>
    </button>
  );
}

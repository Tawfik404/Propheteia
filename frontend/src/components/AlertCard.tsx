import { Flame } from 'lucide-react';
import RiskBadge from './RiskBadge';
import type { Alert } from '../types';

interface AlertCardProps {
  alert: Alert;
}

export default function AlertCard({ alert }: AlertCardProps) {
  return (
    <article className="alert-card" tabIndex={0}>
      <div className="alert-card-header">
        <div className="alert-card-title-row">
          <Flame size={20} className="alert-card-icon" />
          <RiskBadge level={alert.riskLevel} />
        </div>
        <h3 className="alert-card-location">{alert.location}</h3>
      </div>
      <div className="alert-card-body">
        <span className="alert-card-time">{alert.time}</span>
        <p className="alert-card-desc">{alert.description}</p>
      </div>
    </article>
  );
}

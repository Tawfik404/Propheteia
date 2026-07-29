import type { ReactNode } from 'react';

interface SettingCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  control: ReactNode;
  status?: string;
}

export default function SettingCard({ icon, title, description, control, status }: SettingCardProps) {
  return (
    <div className="setting-card">
      <div className="setting-card-left">
        <div className="setting-card-icon">{icon}</div>
        <div className="setting-card-info">
          <h3 className="setting-card-title">{title}</h3>
          <p className="setting-card-desc">{description}</p>
          {status && <span className="setting-card-status">{status}</span>}
        </div>
      </div>
      <div className="setting-card-right">
        {control}
      </div>
    </div>
  );
}

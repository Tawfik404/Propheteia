import { useState } from 'react';
import { Bell, MapPin, Sun, Moon } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import SettingCard from '../components/SettingCard';
import ToggleSwitch from '../components/ToggleSwitch';
import { useTheme } from '../context/ThemeContext';

export default function Settings() {
  const { theme, toggleTheme } = useTheme();
  const [notifications, setNotifications] = useState(false);
  const [gps, setGPS] = useState(false);

  return (
    <div className="page settings-page">
      <PageHeader
        title="Settings"
        description="Configure your application preferences."
      />

      <div className="settings-list">
        <SettingCard
          icon={<Bell size={22} />}
          title="Enable Notifications"
          description="Receive alerts for nearby wildfire risks."
          status="Notification permissions not granted"
          control={
            <ToggleSwitch
              id="notifications"
              enabled={notifications}
              onChange={() => setNotifications(!notifications)}
              label="Enable notifications"
            />
          }
        />

        <SettingCard
          icon={<MapPin size={22} />}
          title="Location Access"
          description="Allow the application to determine nearby wildfire risks."
          control={
            <ToggleSwitch
              id="gps"
              enabled={gps}
              onChange={() => setGPS(!gps)}
              label="Enable location access"
            />
          }
        />

        <div className="setting-card">
          <div className="setting-card-left">
            <div className="setting-card-icon">
              {theme === 'light' ? <Sun size={22} /> : <Moon size={22} />}
            </div>
            <div className="setting-card-info">
              <h3 className="setting-card-title">Theme</h3>
              <p className="setting-card-desc">
                Switch between light and dark mode.
              </p>
            </div>
          </div>
          <div className="theme-selector">
            <button
              type="button"
              className={`theme-option${theme === 'light' ? ' active' : ''}`}
              onClick={() => { if (theme !== 'light') toggleTheme(); }}
              aria-label="Switch to light theme"
            >
              <Sun size={16} />
              <span>Light</span>
            </button>
            <button
              type="button"
              className={`theme-option${theme === 'dark' ? ' active' : ''}`}
              onClick={() => { if (theme !== 'dark') toggleTheme(); }}
              aria-label="Switch to dark theme"
            >
              <Moon size={16} />
              <span>Dark</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

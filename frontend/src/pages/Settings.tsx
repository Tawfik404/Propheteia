import { useState } from 'react';
import { Bell, MapPin, Sun, Moon } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import SettingCard from '../components/SettingCard';
import ToggleSwitch from '../components/ToggleSwitch';
import { useTheme } from '../context/ThemeContext';
import { useSettings } from '../context/SettingsContext';

function notificationsStatusText(status: string): string {
  switch (status) {
    case 'granted':
      return 'Notification permissions granted';
    case 'denied':
      return 'Blocked in browser settings';
    case 'default':
      return 'Permission not requested yet';
    default:
      return 'Not supported by this browser';
  }
}

export default function Settings() {
  const { theme, toggleTheme } = useTheme();
  const {
    settings,
    notificationsStatus,
    notificationsSupported,
    locationSupported,
    enableNotifications,
    disableNotifications,
    enableLocation,
    disableLocation,
  } = useSettings();
  const [busy, setBusy] = useState(false);

  const handleNotifications = async () => {
    if (settings.notifications) {
      disableNotifications();
      return;
    }
    setBusy(true);
    try {
      await enableNotifications();
    } finally {
      setBusy(false);
    }
  };

  const handleLocation = () => {
    if (settings.location) {
      disableLocation();
      return;
    }
    enableLocation();
  };

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
          status={notificationsStatusText(notificationsStatus)}
          control={
            <ToggleSwitch
              id="notifications"
              enabled={settings.notifications}
              onChange={() => void handleNotifications()}
              label="Enable notifications"
              disabled={!notificationsSupported || busy}
            />
          }
        />

        <SettingCard
          icon={<MapPin size={22} />}
          title="Location Access"
          description="Allow the application to determine nearby wildfire risks."
          status={locationSupported ? undefined : 'Not supported by this browser'}
          control={
            <ToggleSwitch
              id="gps"
              enabled={settings.location}
              onChange={handleLocation}
              label="Enable location access"
              disabled={!locationSupported}
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

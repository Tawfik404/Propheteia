import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { SettingsState } from '../types';
import { loadSettings, saveSettings } from '../services/storage';
import {
  isNotificationSupported,
  notificationStatus,
  requestNotificationPermission,
  type NotificationStatus,
} from '../services/notifications';
import { isGeolocationSupported } from '../services/location';

interface SettingsContextType {
  settings: SettingsState;
  notificationsStatus: NotificationStatus;
  locationSupported: boolean;
  notificationsSupported: boolean;
  /** Enable notifications (requests browser permission first). */
  enableNotifications: () => Promise<NotificationStatus>;
  disableNotifications: () => void;
  /** Enable location access (triggers the browser permission prompt). */
  enableLocation: () => void;
  disableLocation: () => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<SettingsState>(() => loadSettings());
  const [notificationsStatus, setNotificationsStatus] = useState<NotificationStatus>(
    notificationStatus()
  );

  const update = (patch: Partial<SettingsState>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  };

  const enableNotifications = useCallback(async () => {
    const status = await requestNotificationPermission();
    setNotificationsStatus(status);
    update({ notifications: status === 'granted' });
    return status;
  }, []);

  const disableNotifications = useCallback(() => {
    setNotificationsStatus(notificationStatus());
    update({ notifications: false });
  }, []);

  const enableLocation = useCallback(() => {
    update({ location: true });
  }, []);

  const disableLocation = useCallback(() => {
    update({ location: false });
  }, []);

  const value = useMemo(
    () => ({
      settings,
      notificationsStatus,
      locationSupported: isGeolocationSupported(),
      notificationsSupported: isNotificationSupported(),
      enableNotifications,
      disableNotifications,
      enableLocation,
      disableLocation,
    }),
    [
      settings,
      notificationsStatus,
      enableNotifications,
      disableNotifications,
      enableLocation,
      disableLocation,
    ]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}

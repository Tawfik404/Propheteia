/**
 * Browser notification helpers.
 */

export type NotificationStatus = 'unsupported' | 'default' | 'granted' | 'denied';

/** Whether the browser supports the Notifications API. */
export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/** Current permission status for notifications. */
export function notificationStatus(): NotificationStatus {
  if (!isNotificationSupported()) return 'unsupported';
  return window.Notification.permission;
}

/** Request the notification permission; returns the resulting status. */
export async function requestNotificationPermission(): Promise<NotificationStatus> {
  if (!isNotificationSupported()) return 'unsupported';
  try {
    const result = await window.Notification.requestPermission();
    return result as NotificationStatus;
  } catch {
    return notificationStatus();
  }
}

/**
 * Show a notification, only when permission has been granted.
 *
 * @param title - notification title
 * @param body - notification body
 * @returns true when the notification was shown
 */
export function showNotification(title: string, body: string): boolean {
  if (!isNotificationSupported() || window.Notification.permission !== 'granted') {
    return false;
  }
  try {
    const notification = new window.Notification(title, {
      body,
      icon: '/vite.svg',
      tag: 'propheteia-alert',
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    return true;
  } catch {
    return false;
  }
}

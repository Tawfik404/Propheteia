import { Wifi, WifiOff, RefreshCw, Loader } from 'lucide-react';
import { useSocket } from '../context/SocketContext';

const statusConfig = {
  connected: { label: 'Connected', icon: Wifi },
  connecting: { label: 'Connecting…', icon: Loader },
  reconnecting: { label: 'Reconnecting…', icon: RefreshCw },
  offline: { label: 'Offline', icon: WifiOff },
} as const;

/**
 * Live badge showing the real-time channel status.
 */
export default function ConnectionStatus() {
  const { status } = useSocket();
  const { label, icon: Icon } = statusConfig[status];

  return (
    <div className={`connection-status connection-status-${status}`} role="status" aria-live="polite">
      <Icon size={14} aria-hidden="true" className={status === 'reconnecting' || status === 'connecting' ? 'spin' : undefined} />
      <span>{label}</span>
    </div>
  );
}

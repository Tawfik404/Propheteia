import { NavLink } from 'react-router-dom';
import { Bell, Map, Settings } from 'lucide-react';

const links = [
  { to: '/alerts', icon: Bell, label: 'Alerts' },
  { to: '/map', icon: Map, label: 'Map' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export default function BottomNavigation() {
  return (
    <nav className="bottom-nav" role="navigation" aria-label="Main navigation">
      {links.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) => `bottom-nav-link${isActive ? ' active' : ''}`}
          aria-label={label}
        >
          <Icon size={22} />
          <span className="bottom-nav-label">{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

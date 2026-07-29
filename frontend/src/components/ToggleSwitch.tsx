interface ToggleSwitchProps {
  enabled: boolean;
  onChange: () => void;
  id: string;
  label: string;
}

export default function ToggleSwitch({ enabled, onChange, id, label }: ToggleSwitchProps) {
  return (
    <button
      role="switch"
      id={id}
      aria-checked={enabled}
      aria-label={label}
      className={`toggle-switch${enabled ? ' active' : ''}`}
      onClick={onChange}
      type="button"
    >
      <span className="toggle-knob" />
    </button>
  );
}

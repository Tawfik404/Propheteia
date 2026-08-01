interface ToggleSwitchProps {
  enabled: boolean;
  onChange: () => void;
  id: string;
  label: string;
  disabled?: boolean;
}

export default function ToggleSwitch({ enabled, onChange, id, label, disabled = false }: ToggleSwitchProps) {
  return (
    <button
      role="switch"
      id={id}
      aria-checked={enabled}
      aria-label={label}
      aria-disabled={disabled}
      disabled={disabled}
      className={`toggle-switch${enabled ? ' active' : ''}${disabled ? ' disabled' : ''}`}
      onClick={onChange}
      type="button"
    >
      <span className="toggle-knob" />
    </button>
  );
}

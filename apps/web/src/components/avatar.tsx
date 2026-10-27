const HUES = [24, 262, 205, 338, 145, 42, 186, 290];

function hueFor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return HUES[hash % HUES.length];
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  user,
  size = 36,
  className = '',
}: {
  user: { id: string; displayName: string };
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={`avatar ${className}`}
      style={{ ['--hue' as any]: hueFor(user.id), width: size, height: size, fontSize: Math.round(size * 0.4) }}
      title={user.displayName}
      aria-hidden="true"
    >
      {initials(user.displayName)}
    </span>
  );
}

export function AvatarStack({ users, size = 28 }: { users: Array<{ id: string; displayName: string }>; size?: number }) {
  return (
    <span className="avatar-stack">
      {users.map((u) => (
        <Avatar key={u.id} user={u} size={size} />
      ))}
    </span>
  );
}

export function ProgressRing({
  value,
  total,
  size = 56,
  stroke = 5,
  children,
}: {
  value: number;
  total: number;
  size?: number;
  stroke?: number;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = total > 0 ? Math.min(1, value / total) : 0;
  return (
    <span className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
        <circle
          className={`ring-fill ${pct === 1 ? 'is-complete' : ''}`}
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="ring-content">{children}</span>
    </span>
  );
}

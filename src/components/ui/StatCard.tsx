interface StatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  className?: string;
}

/** Small label over a large tabular-mono number. Plain white card. */
export function StatCard({ label, value, hint, className = '' }: StatCardProps) {
  return (
    <div className={`bg-surface border border-gray-200 rounded-lg px-4 py-3 ${className}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-mono font-medium text-ink tabular-nums leading-none">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
      {hint && <p className="mt-1.5 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

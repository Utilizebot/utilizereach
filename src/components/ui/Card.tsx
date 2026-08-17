interface CardProps {
  children: React.ReactNode;
  className?: string;
  /** Remove default padding (e.g. when the card wraps a table). */
  flush?: boolean;
}

/** Plain white surface with a 1px border. No shadow, no rounding excess. */
export function Card({ children, className = '', flush = false }: CardProps) {
  return (
    <div className={`bg-surface border border-gray-200 rounded-lg ${flush ? '' : 'p-4'} ${className}`}>
      {children}
    </div>
  );
}

interface CardHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function CardHeader({ title, description, actions, className = '' }: CardHeaderProps) {
  return (
    <div className={`flex items-start justify-between gap-4 px-4 py-3 border-b border-gray-200 ${className}`}>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

type Tone = 'gray' | 'green' | 'red' | 'amber' | 'cyan';

interface BadgeProps {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}

const tones: Record<Tone, string> = {
  gray: 'bg-gray-100 text-gray-700 border-gray-200',
  green: 'bg-green-50 text-green-700 border-green-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  cyan: 'bg-brand-50 text-brand-700 border-brand-200',
};

/** Muted status chip. Quiet by design — never neon. */
export function Badge({ tone = 'gray', children, className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium border ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

import { forwardRef } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'md' | 'sm';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: React.ReactNode;
}

const base =
  'inline-flex items-center justify-center gap-1.5 font-medium rounded-md transition-colors ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap';

const variants: Record<Variant, string> = {
  primary: 'bg-brand-500 hover:bg-brand-600 text-white',
  secondary: 'bg-surface hover:bg-gray-50 text-gray-800 border border-gray-300',
  ghost: 'text-gray-600 hover:text-ink hover:bg-gray-100',
  danger: 'bg-red-700 hover:bg-red-800 text-white',
};

const sizes: Record<Size, string> = {
  md: 'h-9 px-3.5 text-sm',
  sm: 'h-8 px-2.5 text-xs',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', className = '', children, ...rest },
  ref
) {
  return (
    <button ref={ref} className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...rest}>
      {children}
    </button>
  );
});

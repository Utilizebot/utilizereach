import { forwardRef } from 'react';

const fieldBase =
  'h-9 px-3 text-sm bg-surface border border-gray-300 rounded-md text-ink placeholder:text-gray-400 ' +
  'focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition-colors ' +
  'disabled:opacity-50 disabled:bg-gray-50';

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = '', ...rest }, ref) {
    return <input ref={ref} className={`${fieldBase} ${className}`} {...rest} />;
  }
);

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className = '', children, ...rest }, ref) {
    return (
      <select ref={ref} className={`${fieldBase} pr-8 ${className}`} {...rest}>
        {children}
      </select>
    );
  }
);

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className = '', ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        className={`px-3 py-2 text-sm bg-surface border border-gray-300 rounded-md text-ink placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition-colors disabled:opacity-50 ${className}`}
        {...rest}
      />
    );
  }
);

export function Label({ children, className = '', ...rest }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={`block text-xs font-medium text-gray-600 mb-1.5 ${className}`} {...rest}>
      {children}
    </label>
  );
}

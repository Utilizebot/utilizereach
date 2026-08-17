/**
 * Table primitives — internal-tool density.
 * 13px body, compact rows, uppercase 11px column headers, sticky header,
 * right-aligned numeric columns in mono.
 */

export function TableWrap({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-surface border border-gray-200 rounded-lg overflow-hidden ${className}`}>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

export function Table({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <table className={`w-full text-[13px] ${className}`}>{children}</table>;
}

export function THead({ children }: { children: React.ReactNode }) {
  return <thead className="sticky top-0 z-10 bg-gray-50">{children}</thead>;
}

interface THProps {
  children?: React.ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
}

export function TH({ children, align = 'left', className = '' }: THProps) {
  const alignCls = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <th
      className={`px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-gray-500 whitespace-nowrap border-b border-gray-200 ${alignCls} ${className}`}
    >
      {children}
    </th>
  );
}

interface TDProps {
  children?: React.ReactNode;
  align?: 'left' | 'right' | 'center';
  /** Numeric cell: mono + tabular figures. */
  numeric?: boolean;
  className?: string;
  colSpan?: number;
  onClick?: React.MouseEventHandler<HTMLTableCellElement>;
}

export function TD({ children, align = 'left', numeric = false, className = '', colSpan, onClick }: TDProps) {
  const alignCls = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <td
      colSpan={colSpan}
      onClick={onClick}
      className={`px-3 py-2.5 whitespace-nowrap ${alignCls} ${numeric ? 'font-mono tabular-nums' : ''} ${className}`}
    >
      {children}
    </td>
  );
}

export function TR({
  children,
  className = '',
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLTableRowElement>;
}) {
  return (
    <tr
      onClick={onClick}
      className={`border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-colors ${onClick ? 'cursor-pointer' : ''} ${className}`}
    >
      {children}
    </tr>
  );
}

export function TableFooter({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-between gap-3 px-3 py-2 border-t border-gray-200 bg-gray-50 text-xs text-gray-500 ${className}`}>
      {children}
    </div>
  );
}

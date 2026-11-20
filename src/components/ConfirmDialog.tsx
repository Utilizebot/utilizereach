/**
 * ConfirmDialog - in-app confirmation modal (use instead of window.confirm).
 *
 *   <ConfirmDialog
 *     open={open}
 *     title="Disconnect Google Analytics?"
 *     message="..."
 *     confirmLabel="Disconnect"
 *     tone="danger"
 *     busy={working}
 *     onConfirm={doIt}
 *     onCancel={() => setOpen(false)}
 *   />
 *
 * Escape / backdrop click cancel (unless busy). Focus starts on Cancel so a
 * stray Enter never confirms a destructive action.
 */

import { useEffect, useId, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, HelpCircle, Loader2, X } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Latest values for the key handler without re-running the open effect
  // (re-running would bounce focus every time the parent re-renders).
  const busyRef = useRef(busy);
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    busyRef.current = busy;
    onCancelRef.current = onCancel;
  }, [busy, onCancel]);

  // Escape closes; focus the safe action on open, restore focus on close.
  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const t = window.setTimeout(() => cancelRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyRef.current) onCancelRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      prevFocus?.focus();
    };
  }, [open]);

  const danger = tone === 'danger';
  const Icon = danger ? AlertTriangle : HelpCircle;

  return (
    <AnimatePresence>
      {open && (
        <div key="confirm-dialog" className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            className="absolute inset-0 bg-gray-900/50 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !busy && onCancel()}
          />
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={message ? descId : undefined}
            className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden"
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ duration: 0.15 }}
          >
            <div className="p-6">
              <div className="flex items-start gap-4">
                <div
                  className={`h-11 w-11 flex-shrink-0 rounded-xl flex items-center justify-center shadow-md bg-gradient-to-br ${
                    danger ? 'from-red-500 to-rose-600' : 'from-blue-600 to-indigo-600'
                  }`}
                >
                  <Icon className="h-5 w-5 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 id={titleId} className="text-lg font-bold text-gray-900">
                    {title}
                  </h3>
                  {message && (
                    <div id={descId} className="mt-1.5 text-sm text-gray-600 leading-relaxed">
                      {message}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={busy}
                  aria-label="Close"
                  className="p-1.5 -mt-1 -mr-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <button
                ref={cancelRef}
                type="button"
                onClick={onCancel}
                disabled={busy}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 shadow-sm transition-colors disabled:opacity-50"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={busy}
                className={`px-4 py-2.5 rounded-xl text-sm font-semibold text-white shadow-md transition-all disabled:opacity-60 inline-flex items-center justify-center gap-2 bg-gradient-to-r ${
                  danger
                    ? 'from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700'
                    : 'from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700'
                }`}
              >
                {busy && <Loader2 size={16} className="animate-spin" />}
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

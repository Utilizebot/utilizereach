import { Clock, Plus, Trash2 } from 'lucide-react';

export interface Followup { after_days: number; subject: string; body: string }

export function FollowupEditor({ value, onChange }: { value: Followup[]; onChange: (v: Followup[]) => void }) {
  const update = (i: number, patch: Partial<Followup>) => {
    const n = value.map((f, idx) => (idx === i ? { ...f, ...patch } : f));
    onChange(n);
  };
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const add = () => onChange([...value, { after_days: 4, subject: '', body: '' }]);

  return (
    <div>
      <div className="space-y-3">
        {value.map((f, i) => (
          <div key={i} className="border border-gray-200 rounded-xl p-3 bg-gray-50/60">
            <div className="flex items-center gap-2 mb-2">
              <span className="h-6 px-2 rounded-full bg-fuchsia-600 text-white text-xs font-bold flex items-center justify-center whitespace-nowrap">
                Follow-up #{i + 1}
              </span>
              <span className="flex items-center gap-1 text-xs text-gray-500">
                <Clock className="h-3.5 w-3.5" /> after
                <input
                  type="number"
                  min={1}
                  value={f.after_days}
                  onChange={(e) => update(i, { after_days: Math.max(1, +e.target.value || 1) })}
                  className="w-14 px-2 py-1 border border-gray-300 rounded-lg text-sm text-center"
                />
                days
              </span>
              <button
                onClick={() => remove(i)}
                className="ml-auto p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600"
                title="Remove step"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <input
              value={f.subject}
              onChange={(e) => update(i, { subject: e.target.value })}
              placeholder="Subject line"
              className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm mb-2 focus:ring-2 focus:ring-purple-500"
            />
            <textarea
              value={f.body}
              onChange={(e) => update(i, { body: e.target.value })}
              rows={4}
              placeholder="Body (HTML allowed)"
              className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-xs font-mono focus:ring-2 focus:ring-purple-500"
            />
          </div>
        ))}
      </div>
      <button
        onClick={add}
        className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-fuchsia-300 text-fuchsia-600 text-sm font-medium hover:bg-fuchsia-50"
      >
        <Plus className="h-4 w-4" /> Add follow-up step
      </button>
      <p className="text-xs text-gray-400 mt-2">
        Follow-ups are only sent if the lead hasn't replied. {'{first_name}'} and {'{company}'} auto-fill; the CTA link and unsubscribe footer are appended automatically.
      </p>
    </div>
  );
}

/**
 * Brand form fields (General / Branding / Sending) shared by BrandSettings
 * and BrandsSettings. Logic lives in ./brandForm.
 */

import { Building2, Palette, Send, FileText } from 'lucide-react';
import { isDefaultBrand, normalizeDomain, type BrandFormState } from './brandForm';

function FieldRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  );
}

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm bg-white disabled:bg-gray-50 disabled:text-gray-500';

function Section({ icon, title, subtitle, children }: { icon: React.ReactNode; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-1 flex items-center gap-2">{icon}{title}</h3>
      {subtitle && <p className="text-sm text-gray-600 mb-4">{subtitle}</p>}
      <div className={subtitle ? '' : 'mt-4'}>{children}</div>
    </div>
  );
}

function ColorInput({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const valid = /^#[0-9a-fA-F]{6}$/.test(value.trim());
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={valid ? value.trim() : '#ffffff'}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="h-9 w-10 flex-none rounded-lg border border-gray-300 bg-white p-0.5 cursor-pointer disabled:cursor-not-allowed"
      />
      <input value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder="#2563eb"
        className={`${inputCls} font-mono`} />
    </div>
  );
}

export interface BrandFormFieldsProps {
  value: BrandFormState;
  onChange: (next: BrandFormState) => void;
  /** creating a new brand: slug editable */
  isNew?: boolean;
  /** platform admin editing: hostnames editable */
  canEditHostnames?: boolean;
  /** brand id being edited (for brand-1 fallback hints) */
  brandId?: string | null;
  disabled?: boolean;
}

/** All brand fields grouped in sections (General, Branding, Sending). */
export function BrandFormFields({ value, onChange, isNew, canEditHostnames, brandId, disabled }: BrandFormFieldsProps) {
  const set = (k: keyof BrandFormState, v: string | boolean) => onChange({ ...value, [k]: v } as BrandFormState);
  const isDefault = isDefaultBrand(brandId);
  const domain = normalizeDomain(value.website_domain);
  const fallback = (brand1: string, other: string) => (isDefault ? brand1 : other);

  return (
    <div className="space-y-5">
      <Section icon={<Building2 size={20} className="text-primary" />} title="General">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FieldRow label="Display name">
            <input value={value.display_name} onChange={(e) => set('display_name', e.target.value)} disabled={disabled}
              placeholder="e.g. Acme Outreach" className={inputCls} />
          </FieldRow>
          <FieldRow label="Slug" hint={isNew ? 'Short unique id, lowercase. Cannot be changed later.' : 'Cannot be changed.'}>
            <input value={value.slug} onChange={(e) => set('slug', e.target.value.toLowerCase())} disabled={disabled || !isNew}
              placeholder="acme" className={`${inputCls} font-mono`} />
          </FieldRow>
          <FieldRow label="Website domain" hint="Used for default CTA links and UTM tracking.">
            <input value={value.website_domain} onChange={(e) => set('website_domain', e.target.value)} disabled={disabled}
              placeholder="acme.com" className={inputCls} />
          </FieldRow>
          <FieldRow label="Hostnames" hint={canEditHostnames ? 'Comma separated hosts dedicated to this brand (dashboard / forms). Leave empty to use the shared host.' : 'Managed by a platform admin.'}>
            <input value={value.hostnames} onChange={(e) => set('hostnames', e.target.value)} disabled={disabled || !canEditHostnames}
              placeholder="app.acme.com, forms.acme.com" className={inputCls} />
          </FieldRow>
        </div>
      </Section>

      <Section icon={<Palette size={20} className="text-primary" />} title="Branding" subtitle="Company identity and colors shown on the dashboard and public forms. Empty fields use the defaults.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FieldRow label="Company name">
            <input value={value.company_name} onChange={(e) => set('company_name', e.target.value)} disabled={disabled}
              placeholder="Acme Inc." className={inputCls} />
          </FieldRow>
          <FieldRow label="Tagline">
            <input value={value.company_tagline} onChange={(e) => set('company_tagline', e.target.value)} disabled={disabled}
              placeholder="What the company does" className={inputCls} />
          </FieldRow>
          <div className="sm:col-span-2">
            <FieldRow label="Logo URL">
              <div className="flex items-center gap-3">
                <input value={value.company_logo} onChange={(e) => set('company_logo', e.target.value)} disabled={disabled}
                  placeholder="https://acme.com/logo.png" className={inputCls} />
                {/^https?:\/\//.test(value.company_logo.trim()) && (
                  <img src={value.company_logo.trim()} alt="" className="h-9 w-9 flex-none rounded-lg border border-gray-200 object-contain bg-white" />
                )}
              </div>
            </FieldRow>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
          <FieldRow label="Primary color"><ColorInput value={value.primary_color} onChange={(v) => set('primary_color', v)} disabled={disabled} /></FieldRow>
          <FieldRow label="Secondary color"><ColorInput value={value.secondary_color} onChange={(v) => set('secondary_color', v)} disabled={disabled} /></FieldRow>
          <FieldRow label="Accent color"><ColorInput value={value.accent_color} onChange={(v) => set('accent_color', v)} disabled={disabled} /></FieldRow>
        </div>
        <div className="mt-4 pt-4 border-t border-gray-100">
          <p className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2"><FileText size={16} className="text-gray-500" />Lead form</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FieldRow label="Form title">
              <input value={value.form_title} onChange={(e) => set('form_title', e.target.value)} disabled={disabled}
                placeholder="Get in touch" className={inputCls} />
            </FieldRow>
            <FieldRow label="Form subtitle">
              <input value={value.form_subtitle} onChange={(e) => set('form_subtitle', e.target.value)} disabled={disabled}
                placeholder="We'll reply within a day" className={inputCls} />
            </FieldRow>
          </div>
        </div>
      </Section>

      <Section icon={<Send size={20} className="text-primary" />} title="Sending" subtitle="How the daily sender runs for this brand. Empty fields use the platform defaults.">
        <label className="flex items-center gap-3 cursor-pointer select-none mb-4">
          <button type="button" disabled={disabled} onClick={() => set('sending_enabled', !value.sending_enabled)}
            className={`relative h-6 w-11 rounded-full transition-colors flex-none disabled:opacity-50 ${value.sending_enabled ? 'bg-emerald-600' : 'bg-gray-300'}`}>
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${value.sending_enabled ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
          <span className="text-sm text-gray-700">
            <b className="text-gray-900">Sending {value.sending_enabled ? 'enabled' : 'disabled'}</b>
            {' — '}{value.sending_enabled ? 'the daily sender emails this brand’s campaigns.' : 'no outreach email goes out for this brand.'}
          </span>
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FieldRow label="CTA URL" hint="Default call-to-action link in outreach emails.">
            <input value={value.cta_url} onChange={(e) => set('cta_url', e.target.value)} disabled={disabled}
              placeholder={fallback('Default (current setting)', domain ? `https://${domain}` : 'https://<website domain>')} className={inputCls} />
          </FieldRow>
          <FieldRow label="Daily cap" hint="Max outreach emails per day.">
            <input type="number" min={0} value={value.daily_cap} onChange={(e) => set('daily_cap', e.target.value)} disabled={disabled}
              placeholder="Default" className={inputCls} />
          </FieldRow>
          <FieldRow label="Alert sender" hint="Mailbox that sends failure alerts.">
            <input value={value.alert_from} onChange={(e) => set('alert_from', e.target.value)} disabled={disabled}
              placeholder={fallback('Default (current setting)', "The brand's base mailbox")} className={inputCls} />
          </FieldRow>
          <FieldRow label="Alert recipient" hint="Who receives failure alerts.">
            <input value={value.alert_to} onChange={(e) => set('alert_to', e.target.value)} disabled={disabled}
              placeholder="Default" className={inputCls} />
          </FieldRow>
          <FieldRow label="Start hour" hint="0-23, sending window start.">
            <input type="number" min={0} max={23} value={value.start_hour} onChange={(e) => set('start_hour', e.target.value)} disabled={disabled}
              placeholder="Default" className={inputCls} />
          </FieldRow>
          <FieldRow label="End hour" hint="0-23, sending window end.">
            <input type="number" min={0} max={23} value={value.end_hour} onChange={(e) => set('end_hour', e.target.value)} disabled={disabled}
              placeholder="Default" className={inputCls} />
          </FieldRow>
        </div>
      </Section>
    </div>
  );
}


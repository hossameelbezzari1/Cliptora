import type { InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, ReactNode } from 'react'

type Appearance = 'app' | 'light'
const styles = {
  app: {
    field: 'w-full rounded-xl border border-cl-line bg-[#222427] px-3.5 py-3 text-sm text-white placeholder:text-[#747980] focus:border-cl-purple focus:outline-none focus:ring-2 focus:ring-cl-purple/20',
    label: 'text-[#b0b3b7]',
  },
  light: {
    field: 'w-full rounded-lg border border-[#dedede] bg-white px-3 py-2.5 text-[13px] text-[#292929] placeholder:text-[#939393] outline-none transition-colors focus:border-[#9461fc] focus:ring-2 focus:ring-[#9461fc]/10 disabled:bg-[#f7f7f7] disabled:text-[#999]',
    label: 'text-[#444]',
  },
}

type LabelProps = { label: string; appearance?: Appearance; hint?: string; hideLabel?: boolean }
export function Field({ label, appearance = 'app', hint, hideLabel = false, className = '', ...rest }: InputHTMLAttributes<HTMLInputElement> & LabelProps) {
  return <label className={`grid gap-2 text-xs font-semibold ${styles[appearance].label}`}><span className={hideLabel ? 'sr-only' : undefined}>{label}</span><input {...rest} className={`${styles[appearance].field} ${className}`} />{hint && <small className="text-[11px] font-normal leading-4 opacity-65">{hint}</small>}</label>
}
export function TextField({ label, appearance = 'app', hint, hideLabel = false, className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & LabelProps) {
  return <label className={`grid gap-2 text-xs font-semibold ${styles[appearance].label}`}><span className={hideLabel ? 'sr-only' : undefined}>{label}</span><textarea {...rest} className={`${styles[appearance].field} min-h-24 resize-y ${className}`} />{hint && <small className="text-[11px] font-normal leading-4 opacity-65">{hint}</small>}</label>
}
export function SelectField({ label, appearance = 'app', hint, hideLabel = false, className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & LabelProps & { children: ReactNode }) {
  return <label className={`grid gap-2 text-xs font-semibold ${styles[appearance].label}`}><span className={hideLabel ? 'sr-only' : undefined}>{label}</span><select {...rest} className={`${styles[appearance].field} ${className}`}>{children}</select>{hint && <small className="text-[11px] font-normal leading-4 opacity-65">{hint}</small>}</label>
}
export function SwitchField({ label, checked, onChange, disabled = false, description }: { label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; description?: string }) {
  return <label className={`flex cursor-pointer items-center gap-3 text-[13px] text-[#333] ${disabled ? 'opacity-50' : ''}`}>
    <input type="checkbox" className="sr-only peer" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
    <span aria-hidden="true" className={`relative inline-flex h-[22px] w-[40px] shrink-0 rounded-full transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-violet-500 ${checked ? 'bg-[#8155ed]' : 'bg-[#bdbdbd]'}`}>
      <span className={`absolute left-[3px] top-[3px] size-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-[18px]' : ''}`} />
    </span>
    <span>{label}{description && <small className="block text-[11px] text-[#858585]">{description}</small>}</span>
  </label>
}
export function Alert({ error }: { error: unknown }) {
  if (!error) return null
  return <div role="alert" className="rounded-xl border border-red-700/40 bg-red-950/50 px-4 py-3 text-sm text-red-300">{error instanceof Error ? error.message : String(error)}</div>
}

import type { InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, ReactNode } from 'react'

type Appearance = 'app' | 'light'
const styles = {
  app: {
    field: 'w-full rounded-xl border border-cl-line dark:border-cl-dark-line bg-[#f8fafc] dark:bg-[#222427] px-3.5 py-3 text-sm text-gray-900 dark:text-white placeholder:text-[#747980] dark:placeholder:text-[#f3f4f6] focus:border-cl-purple focus:outline-none focus:ring-2 focus:ring-cl-purple/20',
    label: 'text-[#4b5563] dark:text-[#b0b3b7]',
  },
  light: {
    field: 'w-full rounded-lg border border-[#dedede] dark:border-[#374151] bg-white dark:bg-cl-dark-panel px-3 py-2.5 text-[13px] text-[#292929] dark:text-[#f3f4f6] placeholder:text-[#4b5563] dark:placeholder:text-[#939393] outline-none transition-colors focus:border-[#9461fc] focus:ring-2 focus:ring-[#9461fc]/10 disabled:bg-[#f7f7f7] dark:disabled:bg-[#1f2937] disabled:text-[#4b5563] dark:disabled:text-[#999]',
    label: 'text-[#444] dark:text-[#b8bec7]',
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
  return <label className={`flex cursor-pointer items-center gap-3 text-[13px] text-[#333] dark:text-[#f3f4f6] ${disabled ? 'opacity-50' : ''}`}>
    <input type="checkbox" className="sr-only peer" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
    <span aria-hidden="true" className={`relative inline-flex h-[22px] w-[40px] shrink-0 rounded-full transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-violet-500 ${checked ? 'bg-[#f2eefd] dark:bg-[#8155ed]' : 'bg-[#eef2f7] dark:bg-[#bdbdbd]'}`}>
      <span className={`absolute left-[3px] top-[3px] size-4 rounded-full bg-white dark:bg-cl-dark-panel shadow-sm transition-transform ${checked ? 'translate-x-[18px]' : ''}`} />
    </span>
    <span>{label}{description && <small className="block text-[11px] text-[#858585] dark:text-[#b8bec7]">{description}</small>}</span>
  </label>
}
export function Alert({ error }: { error: unknown }) {
  if (!error) return null
  return <div role="alert" className="rounded-xl border border-red-200/40 dark:border-red-700/40 bg-red-50/50 dark:bg-red-950/50 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error instanceof Error ? error.message : String(error)}</div>
}

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger'; icon?: ReactNode }
export function Button({ variant = 'primary', icon, className = '', children, ...props }: ButtonProps) {
  return <button className={`btn btn-${variant} ${className}`} {...props}>{icon}{children}</button>
}

export function Field({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return <label className="field"><span>{label}</span><input {...props} /></label>
}

export function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null
  return <div role="alert" className="form-error">{error instanceof Error ? error.message : 'Something went wrong.'}</div>
}

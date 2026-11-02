import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  appearance?: 'app' | 'light'
  icon?: ReactNode
}

const appVariants = {
  primary: 'bg-white text-[#131416] hover:bg-[#eaeaea]',
  secondary: 'bg-cl-purple text-white hover:bg-[#a24af7]',
  ghost: 'bg-cl-panel-2 text-white border border-cl-line hover:bg-[#303337]',
  danger: 'bg-[#4b232b] text-[#ff9eaa] hover:bg-[#633039]',
}
const lightVariants = {
  primary: 'border border-[#dedede] bg-white text-[#222] hover:bg-[#f5f5f5] shadow-[0_1px_2px_#00000010]',
  secondary: 'bg-[#252525] text-white hover:bg-[#424242]',
  ghost: 'border border-transparent bg-transparent text-[#444] hover:bg-[#f2f2f2]',
  danger: 'border border-red-100 bg-red-50 text-red-600 hover:bg-red-100',
}

export function Button({ variant = 'primary', appearance = 'app', icon, children, className = '', type = 'button', ...rest }: Props) {
  const variants = appearance === 'light' ? lightVariants : appVariants
  return <button {...rest} type={type} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-45 ${variants[variant]} ${className}`}>{icon}{children}</button>
}

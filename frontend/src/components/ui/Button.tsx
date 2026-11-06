import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  appearance?: 'app' | 'light'
  icon?: ReactNode
}

const appVariants = {
  primary: 'bg-white dark:bg-cl-dark-panel text-[#131416] dark:text-[#f3f4f6] hover:bg-[#eaeaea] dark:hover:bg-[#1f2937]',
  secondary: 'bg-cl-purple text-white hover:bg-[#a24af7]',
  ghost: 'bg-cl-panel-2 dark:bg-cl-dark-panel-2 text-gray-900 dark:text-white border border-cl-line dark:border-cl-dark-line hover:bg-[#f8fafc] dark:hover:bg-[#303337]',
  danger: 'bg-[#ede9ea] dark:bg-[#4b232b] text-[#ff9eaa] hover:bg-[#efeaeb] dark:hover:bg-[#633039]',
}
const lightVariants = {
  primary: 'border border-[#dedede] dark:border-[#374151] bg-white dark:bg-cl-dark-panel text-[#222] dark:text-[#f3f4f6] hover:bg-[#f5f5f5] dark:hover:bg-[#1f2937] shadow-[0_1px_2px_#00000010]',
  secondary: 'bg-[#f8fafc] dark:bg-[#252525] text-gray-900 dark:text-white hover:bg-[#f8fafc] dark:hover:bg-[#424242]',
  ghost: 'border border-transparent bg-transparent text-[#444] dark:text-[#b8bec7] hover:bg-[#f2f2f2] dark:hover:bg-[#1f2937]',
  danger: 'border border-red-100 dark:border-red-900/70 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950/40',
}

export function Button({ variant = 'primary', appearance = 'app', icon, children, className = '', type = 'button', ...rest }: Props) {
  const variants = appearance === 'light' ? lightVariants : appVariants
  return <button {...rest} type={type} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-45 ${variants[variant]} ${className}`}>{icon}{children}</button>
}

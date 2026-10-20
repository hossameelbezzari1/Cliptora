import type { ButtonHTMLAttributes, ReactNode } from 'react'
type Props=ButtonHTMLAttributes<HTMLButtonElement>&{variant?:'primary'|'secondary'|'ghost'|'danger';icon?:ReactNode}
const variants={primary:'bg-white text-[#131416] hover:bg-[#eaeaea]',secondary:'bg-cl-purple text-white hover:bg-[#a24af7]',ghost:'bg-cl-panel-2 text-white border border-cl-line hover:bg-[#303337]',danger:'bg-[#4b232b] text-[#ff9eaa] hover:bg-[#633039]'}
export function Button({variant='primary',icon,children,className='',...rest}:Props){return <button {...rest} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${variants[variant]} ${className}`}>{icon}{children}</button>}

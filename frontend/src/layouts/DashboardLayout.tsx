import type { ReactNode } from 'react'
import { Header } from '../components/common/Header'
export function DashboardLayout({children}:{children:ReactNode}){return <div className="min-h-screen bg-cl-bg"><Header/><main className="mx-auto max-w-350 px-5 py-8 lg:px-9">{children}</main></div>}

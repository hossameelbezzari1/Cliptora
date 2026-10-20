import type { ReactNode } from 'react'
import { Header } from '../components/common/Header'
import type { Project } from '../types'
export function EditorLayout({project,saveStatus,children}:{project:Project;saveStatus:string;children:ReactNode}){return <div className="flex h-dvh min-w-[900px] flex-col overflow-hidden bg-cl-bg"><Header project={project} saveStatus={saveStatus}/>{children}</div>}

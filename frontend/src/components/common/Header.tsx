import { useState } from 'react'
import { ChevronDown, FolderOpen, LogOut, Settings, UserRound, WandSparkles } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../app/AuthProvider'
import { Logo } from './Logo'
import type { Project } from '../../types'
export function Header({project,saveStatus}:{project?:Project;saveStatus?:string}){
 const {user,logout}=useAuth();const [open,setOpen]=useState(false);const navigate=useNavigate()
 return <header className="relative z-20 flex h-[76px] shrink-0 items-center gap-5 px-5 lg:px-8"><Logo compact/>
 <nav className="hidden items-center gap-1 rounded-2xl bg-cl-panel p-1 lg:flex"><Link to="/dashboard" aria-label="Projects" title="Projects" className="rounded-xl p-3 text-cl-muted hover:bg-cl-panel-2 hover:text-white"><FolderOpen size={18}/></Link>{project&&<Link to={`/projects/${project.id}/ai-studio`} title="AI Studio" className="rounded-xl p-3 text-cl-muted hover:bg-cl-panel-2 hover:text-white"><WandSparkles size={18}/></Link>}</nav>
 <div className="mx-auto hidden min-w-0 items-center gap-2 text-sm lg:flex"><span className="text-[#62676c]">Projects /</span><strong className="max-w-70 truncate font-medium">{project?.name||'Your workspace'}</strong>{project&&<ChevronDown size={15} className="text-cl-muted"/>}</div>
 <div className="ml-auto flex items-center gap-3 lg:ml-0">{saveStatus&&<span className={`hidden text-xs sm:flex ${saveStatus==='error'?'text-red-400':'text-cl-muted'}`}><span className={`mr-2 mt-1 h-2 w-2 rounded-full ${saveStatus==='saving'?'bg-cl-orange':saveStatus==='error'?'bg-red-400':'bg-cl-green'}`}/>{saveStatus==='saving'?'Saving…':saveStatus==='error'?'Save failed':'Saved'}</span>}
 <div className="relative"><button onClick={()=>setOpen(!open)} aria-label="Account" className="grid h-11 w-11 place-items-center rounded-full border-2 border-cl-line bg-[#f5f5f5] font-bold text-black">{(user?.display_name||'U').slice(0,2).toUpperCase()}</button>{open&&<div className="absolute right-0 top-14 z-50 w-60 rounded-2xl border border-cl-line bg-[#24272a] p-2 shadow-2xl"><div className="border-b border-cl-line p-3"><strong className="block text-sm">{user?.display_name}</strong><small className="text-cl-muted">{user?.email}</small></div><Link to="/profile" onClick={()=>setOpen(false)} className="mt-1 flex items-center gap-2 rounded-xl p-3 text-sm hover:bg-cl-line"><UserRound size={16}/>Profile</Link><Link to="/settings" onClick={()=>setOpen(false)} className="mt-1 flex items-center gap-2 rounded-xl p-3 text-sm hover:bg-cl-line"><Settings size={16}/>Settings</Link><button onClick={async()=>{await logout();navigate('/login')}} className="flex w-full items-center gap-2 rounded-xl p-3 text-left text-sm hover:bg-cl-line"><LogOut size={16}/>Logout</button></div>}</div>
 </div></header>
}

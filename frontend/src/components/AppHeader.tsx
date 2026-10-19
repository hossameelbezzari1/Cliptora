import { useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { Aperture, ChevronDown, Download, FolderOpen, Grid2X2, LogOut, Redo2, Save, Undo2, UserRound } from 'lucide-react'
import { useAuth } from '../auth'
import type { Project } from '../types'
import { Logo } from './BrandLogo'

function AccountMenu() {
  const [open, setOpen] = useState(false); const { user, logout } = useAuth(); const navigate = useNavigate()
  return <div className="account-wrap"><button className="avatar" onClick={()=>setOpen(!open)} aria-expanded={open}>{user?.display_name.slice(0,2).toUpperCase()}</button>{open && <div className="account-menu"><div><strong>{user?.display_name}</strong><span>{user?.email}</span></div><Link to="/profile"><UserRound/>Profile</Link><button onClick={async()=>{await logout();navigate('/login')}}><LogOut/>Logout</button></div>}</div>
}

export function AppHeader({ project, saving, onSave }: { project?: Project; saving?: string; onSave?:()=>void }) {
  return <header className="app-header"><Link to="/dashboard"><Logo /></Link><nav className="top-tools"><NavLink to="/dashboard" title="Projects"><Grid2X2/></NavLink><button disabled title="Workspace: coming soon"><Aperture/></button><button disabled title="Files: coming soon"><FolderOpen/></button><button disabled title="Undo: coming soon"><Undo2/></button><button disabled title="Redo: coming soon"><Redo2/></button></nav><div className="breadcrumbs"><span>Projects</span><b>/</b><strong>{project?.name ?? 'Your studio'}</strong>{project && <ChevronDown size={16}/>}</div><div className="header-actions">{saving && <span className={`save-state ${saving}`}><span/>{saving === 'saving' ? 'Saving…' : saving === 'error' ? 'Save failed' : 'Saved'}</span>}{onSave && <button className="round-tool" onClick={onSave} title="Save now"><Save/></button>}<AccountMenu />{project && <button className="export-btn" disabled title="Export arrives in Phase 6"><Download/> Export <small>Phase 6</small></button>}</div></header>
}

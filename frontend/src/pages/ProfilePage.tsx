import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useMutation } from '../query'
import { api } from '../api'
import { useAuth } from '../auth'
import type { User } from '../types'
import { AppHeader } from '../components/AppHeader'
import { Button, Field, ErrorMessage } from '../components/ui/Controls'

export function ProfilePage(){const {user,refresh}=useAuth();const [name,setName]=useState(user?.display_name??'');const mutation=useMutation({mutationFn:()=>api<User>('/profile',{method:'PATCH',body:JSON.stringify({display_name:name})}),onSuccess:async()=>{await refresh()}});return <div className="app-shell"><AppHeader/><main className="settings-page"><Link to="/dashboard" className="back-link"><ArrowLeft/>Back to projects</Link><div className="settings-card"><p className="eyebrow">ACCOUNT</p><h1>Your profile</h1><form onSubmit={e=>{e.preventDefault();mutation.mutate()}}><Field label="Display name" value={name} onChange={e=>setName(e.target.value)}/><Field label="Email" value={user?.email??''} disabled/><ErrorMessage error={mutation.error}/><Button disabled={mutation.isPending}>Save profile</Button></form></div></main></div>}

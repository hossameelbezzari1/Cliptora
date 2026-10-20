import { useState,type FormEvent } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Header } from '../../components/common/Header'
import { Alert,Field } from '../../components/ui/Field'
import { Button } from '../../components/ui/Button'
import { useAuth } from '../../app/AuthProvider'
import { api } from '../../lib/api'
export function ProfilePage(){const {user,refresh}=useAuth();const [name,setName]=useState(user?.display_name||'');const [busy,setBusy]=useState(false);const [error,setError]=useState<unknown>(null);const [saved,setSaved]=useState(false)
 async function submit(e:FormEvent){e.preventDefault();setBusy(true);setSaved(false);try{await api('/profile',{method:'PATCH',body:JSON.stringify({display_name:name})});await refresh();setSaved(true)}catch(err){setError(err)}finally{setBusy(false)}}
 return <div className="min-h-screen bg-cl-bg"><Header/><main className="mx-auto max-w-2xl px-5 py-12"><Link to="/dashboard" className="flex items-center gap-2 text-sm text-cl-muted"><ArrowLeft size={17}/>Back to projects</Link><section className="mt-7 rounded-3xl bg-cl-panel p-8"><p className="text-xs font-bold tracking-[.22em] text-[#b075ff]">ACCOUNT</p><h1 className="mt-2 font-display text-3xl font-extrabold">Your profile</h1><form className="mt-7 grid gap-5" onSubmit={submit}><Field label="Display name" minLength={2} value={name} onChange={e=>setName(e.target.value)} required/><Field label="Email" value={user?.email||''} disabled/><Alert error={error}/>{saved&&<p className="text-sm text-cl-green">Profile saved.</p>}<Button disabled={busy}>{busy?'Saving…':'Save profile'}</Button></form></section></main></div>}

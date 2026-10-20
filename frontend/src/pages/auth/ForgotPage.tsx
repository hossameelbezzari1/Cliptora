import { useState,type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AuthLayout } from '../../layouts/AuthLayout'
import { Field,Alert } from '../../components/ui/Field'
import { Button } from '../../components/ui/Button'
import { api,currentLink } from '../../lib/api'
export function ForgotPage(){const [email,setEmail]=useState('');const [token,setToken]=useState('');const [done,setDone]=useState(false);const [error,setError]=useState<unknown>(null);const [busy,setBusy]=useState(false)
 async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError(null);try{const r=await api<{message:string;dev_reset_token?:string}>('/auth/forgot-password',{method:'POST',body:JSON.stringify({email})});setToken(r.dev_reset_token||'');setDone(true)}catch(err){setError(err)}finally{setBusy(false)}}
 return <AuthLayout title="Reset access" subtitle="Recover your Cliptora workspace.">{done?<div className="grid gap-4 text-center text-sm"><p className="text-cl-muted">If that address exists, recovery instructions will be sent.</p>{token&&<Link className="rounded-xl border border-cl-purple bg-cl-purple/20 p-3 text-[#cba9ff]" to={new URL(currentLink(`/reset-password?token=${encodeURIComponent(token)}`)).pathname+`?token=${encodeURIComponent(token)}`}>Open local development recovery link</Link>}<Link to="/login" className="text-[#cba9ff]">Back to sign in</Link></div>:<form className="grid gap-5" onSubmit={submit}><Field label="Email" type="email" value={email} onChange={e=>setEmail(e.target.value)} required/><Alert error={error}/><Button disabled={busy}>{busy?'Sending…':'Request reset'}</Button></form>}</AuthLayout>}

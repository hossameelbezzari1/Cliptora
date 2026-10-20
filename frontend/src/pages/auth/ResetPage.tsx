import { useState,type FormEvent } from 'react'
import { useNavigate,useSearchParams } from 'react-router-dom'
import { AuthLayout } from '../../layouts/AuthLayout'
import { Alert,Field } from '../../components/ui/Field'
import { Button } from '../../components/ui/Button'
import { api } from '../../lib/api'
export function ResetPage(){const [params]=useSearchParams();const token=params.get('token')||'';const navigate=useNavigate();const [password,setPassword]=useState('');const [confirm,setConfirm]=useState('');const [error,setError]=useState<unknown>(null);const [busy,setBusy]=useState(false)
 async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError(null);try{await api('/auth/reset-password',{method:'POST',body:JSON.stringify({token,password,password_confirmation:confirm})});navigate('/login')}catch(err){setError(err)}finally{setBusy(false)}}
 return <AuthLayout title="Choose a new password" subtitle="Your previous sessions will be signed out."><form className="grid gap-5" onSubmit={submit}><Field label="New password" type="password" minLength={10} required value={password} onChange={e=>setPassword(e.target.value)}/><Field label="Confirm password" type="password" minLength={10} required value={confirm} onChange={e=>setConfirm(e.target.value)}/><Alert error={error}/><Button disabled={busy||!token}>Reset password</Button></form></AuthLayout>}

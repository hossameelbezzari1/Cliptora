import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthLayout } from '../../layouts/AuthLayout'
import { Alert,Field } from '../../components/ui/Field'
import { Button } from '../../components/ui/Button'
import { api } from '../../lib/api'
import { useAuth } from '../../app/AuthProvider'
export function RegisterPage(){const navigate=useNavigate();const {refresh}=useAuth();const [form,setForm]=useState({display_name:'',email:'',password:'',password_confirmation:''});const [error,setError]=useState<unknown>(null);const [busy,setBusy]=useState(false)
 async function submit(e:FormEvent){e.preventDefault();setError(null);setBusy(true);try{await api('/auth/register',{method:'POST',body:JSON.stringify(form)});await refresh();navigate('/dashboard',{replace:true})}catch(err){setError(err)}finally{setBusy(false)}}
 return <AuthLayout title="Create your studio" subtitle="One secure place for every cut and idea."><form onSubmit={submit} className="grid gap-4"><Field label="Display name" minLength={2} required value={form.display_name} onChange={e=>setForm({...form,display_name:e.target.value})}/><Field label="Email" type="email" required value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/><div className="grid gap-4 sm:grid-cols-2"><Field label="Password" type="password" minLength={10} required value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/><Field label="Confirm password" type="password" minLength={10} required value={form.password_confirmation} onChange={e=>setForm({...form,password_confirmation:e.target.value})}/></div><Alert error={error}/><Button disabled={busy} className="w-full">{busy?'Creating account…':'Create account'}</Button></form><p className="mt-7 text-center text-xs text-cl-muted">Already have an account? <Link className="font-semibold text-[#b78af7]" to="/login">Sign in</Link></p></AuthLayout>}

import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { AuthLayout } from '../../layouts/AuthLayout'
import { Alert,Field } from '../../components/ui/Field'
import { Button } from '../../components/ui/Button'
import { api } from '../../lib/api'
import { useAuth } from '../../app/AuthProvider'
export function LoginPage(){const navigate=useNavigate();const location=useLocation();const {refresh}=useAuth();const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [error,setError]=useState<unknown>(null);const [busy,setBusy]=useState(false)
 async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError(null);try{await api('/auth/login',{method:'POST',body:JSON.stringify({email,password})});await refresh();navigate((location.state as {from?:string}|null)?.from||'/dashboard',{replace:true})}catch(err){setError(err)}finally{setBusy(false)}}
 return <AuthLayout title="Welcome back" subtitle="Continue shaping your next story."><form className="grid gap-5" onSubmit={submit}><Field label="Email" type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required/><Field label="Password" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/><div className="text-right text-xs"><Link to="/forgot-password" className="text-[#b78af7] hover:underline">Forgot password?</Link></div><Alert error={error}/><Button disabled={busy} className="w-full">{busy?'Signing in…':'Sign in'}<ArrowRight size={17}/></Button></form><p className="mt-7 text-center text-xs text-cl-muted">New to Cliptora? <Link to="/register" className="font-semibold text-[#b78af7] hover:underline">Create an account</Link></p></AuthLayout>}

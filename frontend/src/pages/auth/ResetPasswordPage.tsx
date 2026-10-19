import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useMutation } from '../../query'
import { api } from '../../api'
import { Button, Field, ErrorMessage } from '../../components/ui/Controls'
import { AuthShell } from '../../layouts/AuthShell'

export function ResetPasswordPage() {
  const token = new URLSearchParams(useLocation().search).get('token') ?? ''; const navigate = useNavigate()
  const [password, setPassword] = useState(''); const [confirmation, setConfirmation] = useState('')
  const mutation = useMutation({ mutationFn: () => api('/auth/reset-password', { method:'POST', body:JSON.stringify({token, password, password_confirmation:confirmation}) }), onSuccess:()=>navigate('/login') })
  return <AuthShell title="Choose a new password" subtitle="This will sign out all other sessions."><form className="auth-form" onSubmit={e=>{e.preventDefault();mutation.mutate()}}><Field label="New password" type="password" minLength={10} value={password} onChange={e=>setPassword(e.target.value)} required/><Field label="Confirm password" type="password" value={confirmation} onChange={e=>setConfirmation(e.target.value)} required/><ErrorMessage error={mutation.error}/><Button disabled={!token || mutation.isPending}>Reset password</Button></form></AuthShell>
}

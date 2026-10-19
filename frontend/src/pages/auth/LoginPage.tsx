import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useMutation } from '../../query'
import { api, clearCsrf } from '../../api'
import { useAuth } from '../../auth'
import type { User } from '../../types'
import { Button, Field, ErrorMessage } from '../../components/ui/Controls'
import { AuthShell } from '../../layouts/AuthShell'

export function LoginPage() {
  const navigate = useNavigate(); const location = useLocation(); const { refresh } = useAuth()
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('')
  const mutation = useMutation({ mutationFn: () => api<User>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }), onSuccess: async () => { clearCsrf(); await refresh(); navigate((location.state as {from?: string})?.from ?? '/dashboard', { replace: true }) } })
  return <AuthShell title="Welcome back" subtitle="Continue shaping your next story.">
    <form onSubmit={(e) => { e.preventDefault(); mutation.mutate() }} className="auth-form">
      <Field label="Email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required />
      <Field label="Password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
      <div className="form-row"><label className="check"><input type="checkbox" /> Keep me signed in</label><Link to="/forgot-password">Forgot password?</Link></div>
      <ErrorMessage error={mutation.error} />
      <Button disabled={mutation.isPending}>{mutation.isPending ? 'Signing in…' : 'Sign in'} <ArrowLeft className="button-arrow" size={18} /></Button>
    </form>
    <p className="auth-switch">New to Cliptora? <Link to="/register">Create an account</Link></p>
  </AuthShell>
}

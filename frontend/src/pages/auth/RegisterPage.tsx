import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation } from '../../query'
import { api, clearCsrf } from '../../api'
import { useAuth } from '../../auth'
import type { User } from '../../types'
import { Button, Field, ErrorMessage } from '../../components/ui/Controls'
import { AuthShell } from '../../layouts/AuthShell'

export function RegisterPage() {
  const navigate = useNavigate(); const { refresh } = useAuth()
  const [form, setForm] = useState({ display_name: '', email: '', password: '', password_confirmation: '' })
  const mutation = useMutation({ mutationFn: () => api<User>('/auth/register', { method: 'POST', body: JSON.stringify(form) }), onSuccess: async () => { clearCsrf(); await refresh(); navigate('/dashboard') } })
  return <AuthShell title="Create your studio" subtitle="One secure place for every cut and idea.">
    <form onSubmit={(e) => { e.preventDefault(); mutation.mutate() }} className="auth-form">
      <Field label="Display name" value={form.display_name} onChange={e => setForm({...form, display_name: e.target.value})} minLength={2} required />
      <Field label="Email" type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} required />
      <div className="field-grid"><Field label="Password" type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} minLength={10} required /><Field label="Confirm password" type="password" value={form.password_confirmation} onChange={e => setForm({...form, password_confirmation: e.target.value})} required /></div>
      <ErrorMessage error={mutation.error} /><Button disabled={mutation.isPending}>{mutation.isPending ? 'Creating…' : 'Create account'}</Button>
    </form>
    <p className="auth-switch">Already have an account? <Link to="/login">Sign in</Link></p>
  </AuthShell>
}

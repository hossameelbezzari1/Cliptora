import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import { useMutation } from '../../query'
import { api } from '../../api'
import { Button, Field, ErrorMessage } from '../../components/ui/Controls'
import { AuthShell } from '../../layouts/AuthShell'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState(''); const [sent, setSent] = useState(false); const [devLink, setDevLink] = useState('')
  const mutation = useMutation({ mutationFn: () => api<{message:string; dev_reset_url?:string}>('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }), onSuccess: data => { setSent(true); setDevLink(data.dev_reset_url ?? '') } })
  return <AuthShell title="Reset access" subtitle="We’ll send a short-lived recovery link.">
    {sent ? <div className="success-state"><div><Check /></div><h2>Check your inbox</h2><p>If that address exists, a reset link is on its way.</p>{devLink && <a href={devLink}>Open local development reset link</a>}<Link to="/login">Back to sign in</Link></div> : <form onSubmit={e => {e.preventDefault(); mutation.mutate()}} className="auth-form"><Field label="Email" type="email" value={email} onChange={e=>setEmail(e.target.value)} required /><ErrorMessage error={mutation.error}/><Button disabled={mutation.isPending}>Send recovery link</Button></form>}
  </AuthShell>
}

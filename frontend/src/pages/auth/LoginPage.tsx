
import {
  useEffect,
  useState,
  type FormEvent,
} from 'react'

import {
  Link,
  useLocation,
  useNavigate,
} from 'react-router-dom'

import { ArrowRight } from 'lucide-react'

import { AuthLayout } from '../../layouts/AuthLayout'

import {
  Alert,
  Field,
} from '../../components/ui/Field'

import { Button } from '../../components/ui/Button'

import { api } from '../../lib/api'

import { useAuth } from '../../app/AuthProvider'

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()

  const {
    user,
    loading,
    refresh,
  } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const previousPage = (
    location.state as { from?: string } | null
  )?.from

  const redirectTo =
    typeof previousPage === 'string' &&
    previousPage.startsWith('/') &&
    !previousPage.startsWith('//') &&
    !previousPage.startsWith('/login')
      ? previousPage
      : '/dashboard'

  // Already authenticated? Do not show Login.
  useEffect(() => {
    if (!loading && user) {
      navigate(redirectTo, {
        replace: true,
      })
    }
  }, [
    loading,
    user,
    navigate,
    redirectTo,
  ])

  async function submit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault()

    if (busy) return

    setBusy(true)
    setError(null)

    try {
      await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: email.trim(),
          password,
        }),
      })

      // Confirm that the new session is valid.
      const authenticatedUser = await refresh()

      if (!authenticatedUser) {
        throw new Error(
          'Login succeeded, but the session was not saved. Check browser cookies and the API proxy.'
        )
      }

      // The useEffect above redirects after
      // AuthProvider updates the authenticated user.
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  if (loading || user) {
    return (
      <div className="grid min-h-screen place-items-center bg-cl-bg dark:bg-cl-dark-bg text-cl-muted dark:text-cl-dark-muted">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 animate-spin rounded-full border-2 border-current border-t-transparent" />

          <p className="text-sm">
            {user
              ? 'Redirecting to Cliptora…'
              : 'Checking your session…'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Continue shaping your next story."
    >
      <form
        className="grid gap-5"
        onSubmit={submit}
      >
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value)
          }}
          required
        />

        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value)
          }}
          required
        />

        <div className="text-right text-xs">
          <Link
            to="/forgot-password"
            className="text-[#b78af7] hover:underline"
          >
            Forgot password?
          </Link>
        </div>

        <Alert error={error} />

        <Button
          disabled={busy}
          className="w-full"
        >
          {busy ? 'Signing in…' : 'Sign in'}

          <ArrowRight size={17} />
        </Button>
      </form>

      <p className="mt-7 text-center text-xs text-cl-muted dark:text-cl-dark-muted">
        New to Cliptora?{' '}

        <Link
          to="/register"
          className="font-semibold text-[#b78af7] hover:underline"
        >
          Create an account
        </Link>
      </p>
    </AuthLayout>
  )
}

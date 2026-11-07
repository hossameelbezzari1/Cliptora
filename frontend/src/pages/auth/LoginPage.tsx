
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

import {
  ArrowRight,
  Eye,
  EyeOff,
  LoaderCircle,
  Lock as LockKeyRound,
  Mail,
  ShieldCheck,
} from 'lucide-react'

import { AuthLayout } from '../../layouts/AuthLayout'
import { api } from '../../lib/api'
import { useAuth } from '../../app/AuthProvider'

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()

  const { user, loading, refresh } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

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

  useEffect(() => {
    if (!loading && user) {
      navigate(redirectTo, { replace: true })
    }
  }, [loading, user, navigate, redirectTo])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (busy) return

    setBusy(true)
    setError('')

    try {
      await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
        }),
      })

      const authenticatedUser = await refresh()

      if (!authenticatedUser) {
        throw new Error(
          'Your login was accepted, but the session could not be verified. Please check your browser cookies.'
        )
      }

      navigate(redirectTo, { replace: true })
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to sign in. Please try again.'
      )
    } finally {
      setBusy(false)
    }
  }

  if (loading || user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#f8f9fc] text-[#6b7280] dark:bg-[#10141c] dark:text-[#aeb6c5]">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-violet-500/10">
          <LoaderCircle
            size={25}
            className="animate-spin text-violet-600 dark:text-violet-400"
          />
        </div>

        <p className="text-sm font-medium">
          {user
            ? 'Opening your workspace…'
            : 'Checking your session…'}
        </p>
      </div>
    )
  }

  const inputClass = [
    'h-[52px] w-full rounded-xl border',
    'border-[#e4e7ed] bg-[#f9fafc]',
    'pl-11 pr-4 text-[14px] font-medium',
    'text-[#202938] placeholder:text-[#a0a8b5]',
    'outline-none transition-all duration-200',
    'hover:border-[#cfd4df]',
    'focus:border-violet-500 focus:bg-white',
    'focus:ring-4 focus:ring-violet-500/10',
    'dark:border-[#363e4d] dark:bg-[#252c39]',
    'dark:text-[#f1f3f7] dark:placeholder:text-[#7d8798]',
    'dark:hover:border-[#525d71]',
    'dark:focus:border-violet-400',
    'dark:focus:bg-[#202633]',
  ].join(' ')

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to continue creating with CLIPTORA."
    >
      <div className="w-full">
        <form
          onSubmit={submit}
          aria-busy={busy}
          className="space-y-5"
        >
          {/* Email */}
          <div className="space-y-2">
            <label
              htmlFor="login-email"
              className="block text-[13px] font-semibold text-[#374151] dark:text-[#e5e7eb]"
            >
              Email address
            </label>

            <div className="group relative">
              <Mail
                size={18}
                aria-hidden="true"
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#98a2b3] transition-colors group-focus-within:text-violet-500"
              />

              <input
                id="login-email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={255}
                required
                disabled={busy}
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value)
                  if (error) setError('')
                }}
                placeholder="you@example.com"
                className={inputClass}
              />
            </div>
          </div>

          {/* Password */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label
                htmlFor="login-password"
                className="text-[13px] font-semibold text-[#374151] dark:text-[#e5e7eb]"
              >
                Password
              </label>

              <Link
                to="/forgot-password"
                className="text-[12px] font-semibold text-violet-600 transition-colors hover:text-violet-800 hover:underline dark:text-violet-400 dark:hover:text-violet-300"
              >
                Forgot password?
              </Link>
            </div>

            <div className="group relative">
              <LockKeyRound
                size={18}
                aria-hidden="true"
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#98a2b3] transition-colors group-focus-within:text-violet-500"
              />

              <input
                id="login-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                disabled={busy}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value)
                  if (error) setError('')
                }}
                placeholder="Enter your password"
                className={`${inputClass} pr-12`}
              />

              <button
                type="button"
                disabled={busy}
                aria-label={
                  showPassword
                    ? 'Hide password'
                    : 'Show password'
                }
                aria-pressed={showPassword}
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-[#98a2b3] transition-colors hover:bg-black/5 hover:text-violet-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:opacity-50 dark:hover:bg-white/10 dark:hover:text-violet-400"
              >
                {showPassword ? (
                  <EyeOff size={18} />
                ) : (
                  <Eye size={18} />
                )}
              </button>
            </div>
          </div>

          {/* Authentication errors */}
          {error && (
            <div
              role="alert"
              aria-live="polite"
              className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] leading-5 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"
            >
              <span className="mt-[3px] size-1.5 shrink-0 rounded-full bg-red-500" />
              <span>{error}</span>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={busy}
            className="group relative flex h-[52px] w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-[#7c3aed] to-[#6d28d9] px-5 text-[14px] font-bold text-white shadow-[0_6px_18px_rgba(124,58,237,0.2)] transition-all duration-200 hover:from-[#6d28d9] hover:to-[#5b21b6] hover:shadow-[0_8px_22px_rgba(124,58,237,0.3)] active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-65 disabled:shadow-none"
          >
            {busy ? (
              <>
                <LoaderCircle
                  size={18}
                  className="animate-spin"
                />
                <span>Signing in…</span>
              </>
            ) : (
              <>
                <span>Sign in to your account</span>

                <ArrowRight
                  size={18}
                  className="transition-transform duration-200 group-hover:translate-x-1"
                />
              </>
            )}
          </button>
        </form>

        {/* Footer */}
        <div className="mt-7 border-t border-[#e8eaf0] pt-6 dark:border-[#343b49]">
          <p className="text-center text-[13px] text-[#7b8493] dark:text-[#a4adbd]">
            New to CLIPTORA?{' '}
            <Link
              to="/register"
              className="font-bold text-violet-600 transition-colors hover:text-violet-800 hover:underline dark:text-violet-400 dark:hover:text-violet-300"
            >
              Create an account
            </Link>
          </p>
        </div>

        <div className="mt-7 flex items-center justify-center gap-2 text-[#98a2b3] dark:text-[#7f8999]">
          <ShieldCheck
            size={15}
            aria-hidden="true"
          />
          <span className="text-[11px]">
            Secure authentication · Private workspace
          </span>
        </div>
      </div>
    </AuthLayout>
  )
}

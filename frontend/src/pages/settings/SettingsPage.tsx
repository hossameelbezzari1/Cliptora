
import {
  useCallback,
  useEffect,
  useState,
} from 'react'

import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Globe2,
  KeyRound,
  LoaderCircle,
  Monitor,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  X,
} from 'lucide-react'

import { Link } from 'react-router-dom'
import { Header } from '../../components/common/Header'
import { api } from '../../lib/api'

type Credential = {
  id: number
  name: string
  provider: string
  auth_type: string
  created_at: string | null
  updated_at: string | null
}

type BrowserSession = {
  capture_id: string
  provider: string
  name: string
  browser_open: boolean
}

type SaveResult = {
  credential: Credential
  status: string
  warnings: string[]
}

const providers = [
  { id: 'tiktok', name: 'TikTok' },
  { id: 'instagram', name: 'Instagram' },
  { id: 'youtube', name: 'YouTube' },
]

const panel =
  'rounded-2xl border border-[#e7e7eb] bg-white p-5 shadow-sm'

const button =
  'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-[#dedee3] bg-white px-3 py-2 text-xs font-semibold text-[#34343a] hover:bg-[#f7f7fa] disabled:cursor-not-allowed disabled:opacity-50'

const darkButton =
  `${button} border-[#232329] bg-[#232329] text-white hover:bg-[#3b3b42]`

export function SettingsPage() {
  const [healthy, setHealthy] =
    useState<boolean | null>(null)

  const [credentials, setCredentials] =
    useState<Credential[]>([])

  const [provider, setProvider] =
    useState('tiktok')

  const [name, setName] =
    useState('TikTok Personal')

  const [capture, setCapture] =
    useState<BrowserSession | null>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [warnings, setWarnings] =
    useState<string[]>([])

  const refresh = useCallback(async () => {
    const rows = await api<Credential[]>('/credentials')
    setCredentials(rows)
  }, [])

  useEffect(() => {
    let active = true

    void api<{ status: string }>('/health')
      .then(() => {
        if (active) setHealthy(true)
      })
      .catch(() => {
        if (active) setHealthy(false)
      })

    void refresh().catch(reason => {
      if (active) {
        setError(
          reason instanceof Error
            ? reason.message
            : String(reason)
        )
      }
    })

    return () => {
      active = false
    }
  }, [refresh])

  async function perform(
    action: () => Promise<void>
  ) {
    setBusy(true)
    setError('')
    setMessage('')
    setWarnings([])

    try {
      await action()
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : String(reason)
      )
    } finally {
      setBusy(false)
    }
  }

  const start = () => void perform(async () => {
    const result = await api<BrowserSession>(
      '/credentials/browser/start',
      {
        method: 'POST',
        body: JSON.stringify({
          provider,
          name: name.trim(),
        }),
      },
    )

    setCapture(result)

    setMessage(
      'Chrome opened on the backend desktop. ' +
      'Log in manually, then click Save Session.',
    )
  })

  const reopen = (credential: Credential) =>
    void perform(async () => {
      const result = await api<BrowserSession>(
        `/credentials/${credential.id}/browser/open`,
        {
          method: 'POST',
        },
      )

      setCapture(result)

      setMessage(
        'Saved snapshot loaded into a temporary browser. ' +
        'Check your login status in Chrome.',
      )
    })

  const save = () => {
    if (!capture) return

    void perform(async () => {
      const result = await api<SaveResult>(
        `/credentials/browser/${capture.capture_id}/save`,
        {
          method: 'POST',
        },
      )

      setCapture(null)
      setWarnings(result.warnings)

      await refresh()

      setMessage(
        `${result.credential.name}: encrypted snapshot saved. ` +
        'Authentication is not automatically verified.',
      )
    })
  }

  const close = () => {
    if (!capture) return

    void perform(async () => {
      await api<void>(
        `/credentials/browser/${capture.capture_id}`,
        {
          method: 'DELETE',
        },
      )

      setCapture(null)

      setMessage(
        'Temporary browser closed and profile removed.',
      )
    })
  }

  const remove = (credential: Credential) => {
    if (
      !window.confirm(
        `Delete saved connection "${credential.name}"?`
      )
    ) {
      return
    }

    void perform(async () => {
      await api<void>(
        `/credentials/${credential.id}`,
        {
          method: 'DELETE',
        },
      )

      await refresh()

      setMessage('Connection deleted.')
    })
  }

  const browserCredentials = credentials.filter(
    row => row.auth_type === 'browser_session',
  )

  const apiCredentials = credentials.filter(
    row => row.auth_type !== 'browser_session',
  )

  return (
    <div className="min-h-screen bg-[#fafafa] text-[#202024]">
      <Header />

      <main className="mx-auto max-w-4xl px-5 py-10">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-2 text-xs text-[#777] hover:text-[#333]"
        >
          <ArrowLeft size={15} />
          Back to projects
        </Link>

        <div className="mt-7">
          <p className="text-xs font-bold uppercase tracking-[.16em] text-violet-600">
            Workspace
          </p>

          <h1 className="mt-2 text-3xl font-bold">
            Settings & Connections
          </h1>

          <p className="mt-2 text-sm text-[#777]">
            Manage your encrypted API credentials
            and browser session snapshots.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        {message && (
          <div
            role="status"
            className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
          >
            {message}
          </div>
        )}

        {!!warnings.length && (
          <div
            role="status"
            className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900"
          >
            Some IndexedDB records could not be captured:
            {' '}
            {warnings.join(' · ')}
          </div>
        )}

        <section className={`${panel} mt-6`}>
          <div className="mb-4 flex items-center gap-2">
            <Monitor
              size={20}
              className="text-violet-600"
            />

            <h2 className="font-semibold">
              Browser Accounts
            </h2>
          </div>

          <p className="mb-4 text-xs leading-5 text-[#777]">
            Chrome opens on the same Windows desktop
            that runs FastAPI. Complete login manually,
            including 2FA. The session snapshot is
            encrypted and stored in MySQL; no permanent
            Chrome profile or .pkl file is retained.
          </p>

          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <label className="grid gap-1 text-xs font-semibold text-[#555]">
              Website

              <select
                value={provider}
                disabled={busy || !!capture}
                onChange={event => {
                  const next = event.target.value

                  setProvider(next)

                  setName(
                    `${
                      providers.find(p => p.id === next)?.name
                      ?? 'Account'
                    } Personal`,
                  )
                }}
                className="h-10 rounded-lg border border-[#dedee3] bg-white px-3 text-sm outline-none focus:border-violet-400"
              >
                {providers.map(p => (
                  <option
                    key={p.id}
                    value={p.id}
                  >
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1 text-xs font-semibold text-[#555]">
              Connection name

              <input
                value={name}
                maxLength={160}
                disabled={busy || !!capture}
                onChange={event =>
                  setName(event.target.value)
                }
                className="h-10 rounded-lg border border-[#dedee3] px-3 text-sm outline-none focus:border-violet-400"
              />
            </label>

            <button
              type="button"
              disabled={
                busy ||
                !!capture ||
                !name.trim()
              }
              onClick={start}
              className={`${darkButton} self-end`}
            >
              <Plus size={15} />
              Add account
            </button>
          </div>

          {capture && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50/40 p-4">
              <div>
                <strong className="text-sm">
                  Browser open — {capture.name}
                </strong>

                <p className="mt-1 text-xs text-[#777]">
                  Log in or inspect the website in Chrome
                  before saving.
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={save}
                  className={darkButton}
                >
                  {busy
                    ? (
                      <LoaderCircle
                        size={14}
                        className="animate-spin"
                      />
                    )
                    : <CheckCircle2 size={14} />
                  }

                  Save Session
                </button>

                <button
                  type="button"
                  disabled={busy}
                  onClick={close}
                  className={button}
                >
                  <X size={14} />
                  Close
                </button>
              </div>
            </div>
          )}

          <div className="mt-5 divide-y divide-[#eee]">
            {browserCredentials.length === 0 && (
              <p className="py-5 text-center text-xs text-[#999]">
                No browser accounts saved.
              </p>
            )}

            {browserCredentials.map(credential => (
              <div
                key={credential.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-xl bg-[#f4f2fa]">
                    <Globe2
                      size={18}
                      className="text-violet-600"
                    />
                  </span>

                  <div>
                    <strong className="text-sm">
                      {credential.name}
                    </strong>

                    <p className="mt-1 text-[11px] capitalize text-[#888]">
                      {credential.provider}
                      {' · '}
                      Encrypted snapshot saved
                      {' · '}
                      Login not verified
                    </p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    className={button}
                    disabled={busy || !!capture}
                    onClick={() => reopen(credential)}
                  >
                    <RefreshCw size={14} />
                    Open Session
                  </button>

                  <button
                    type="button"
                    className={button}
                    disabled={busy || !!capture}
                    title="Delete connection"
                    onClick={() => remove(credential)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className={`${panel} mt-5`}>
          <div className="mb-3 flex items-center gap-2">
            <KeyRound
              size={20}
              className="text-violet-600"
            />

            <h2 className="font-semibold">
              API & Local Credentials
            </h2>
          </div>

          <p className="text-xs leading-5 text-[#777]">
            Existing Gemini, OpenAI and Ollama
            credentials remain available through the
            same backend. Secrets are never displayed here.
          </p>

          <div className="mt-3 divide-y divide-[#eee]">
            {apiCredentials.map(item => (
              <p
                key={item.id}
                className="py-2 text-xs"
              >
                <strong>{item.name}</strong>

                <span className="ml-2 text-[#999]">
                  {item.provider}
                </span>
              </p>
            ))}

            {!apiCredentials.length && (
              <p className="py-3 text-xs text-[#999]">
                No API credentials saved yet.
              </p>
            )}
          </div>
        </section>

        <section className={`${panel} mt-5`}>
          <div className="flex items-center gap-2">
            <Server
              size={19}
              className="text-[#666]"
            />

            <h2 className="font-semibold">
              Backend
            </h2>
          </div>

          <p className="mt-3 text-xs">
            API:
            {' '}
            <span
              className={
                healthy
                  ? 'text-emerald-600'
                  : 'text-[#888]'
              }
            >
              {healthy === null
                ? 'Checking…'
                : healthy
                  ? 'Online'
                  : 'Offline'}
            </span>
          </p>

          <a
            href="/api/v1/health"
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-2 text-xs text-violet-700"
          >
            <ExternalLink size={14} />
            Open health endpoint
          </a>
        </section>
      </main>
    </div>
  )
}

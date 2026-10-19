const API = import.meta.env.DEV ? '/api/v1' : (import.meta.env.VITE_API_URL ?? '/api/v1')
let csrfToken = ''

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

async function ensureCsrf() {
  if (csrfToken) return csrfToken
  const response = await fetch(`${API}/auth/csrf`, { credentials: 'include' })
  if (!response.ok) throw new ApiError(response.status, 'Could not initialize a secure session.')
  csrfToken = (await response.json()).csrf_token
  return csrfToken
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase()
  const headers = new Headers(options.headers)
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) headers.set('X-CSRF-Token', await ensureCsrf())
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${API}${path}`, { ...options, headers, credentials: 'include' })
  if (response.status === 204) return undefined as T
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(response.status, payload.detail ?? 'Something went wrong.')
  return payload
}

export function clearCsrf() { csrfToken = '' }

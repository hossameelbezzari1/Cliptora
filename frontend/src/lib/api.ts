const ROOT = '/api/v1'
let csrf = ''

export class ApiError extends Error {
  constructor(public status: number, message: string) {super(message)}
}

async function csrfToken(): Promise<string> {
  if (csrf) return csrf
  const response = await fetch(`${ROOT}/auth/csrf`, {credentials:'include'})
  if (!response.ok) throw new ApiError(response.status,'Cannot initialize secure session.')
  const result = await response.json()
  csrf = result.csrf_token
  return csrf
}

function errorMessage(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) return detail.map(x => x?.msg || 'Invalid input').join('; ')
  return 'Something went wrong.'
}

export async function api<T>(path:string, options:RequestInit = {}):Promise<T> {
  const method=(options.method||'GET').toUpperCase()
  const headers=new Headers(options.headers)
  if (!['GET','HEAD','OPTIONS'].includes(method)) headers.set('X-CSRF-Token',await csrfToken())
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type','application/json')
  const response=await fetch(`${ROOT}${path}`,{...options,headers,credentials:'include'})
  if (response.status===204) return undefined as T
  const result=await response.json().catch(()=>({}))
  if (!response.ok) throw new ApiError(response.status,errorMessage(result.detail))
  return result as T
}
export function resetCsrf(){csrf=''}
export function fileUrl(mediaId:number){return `${ROOT}/media/${mediaId}/file`}
export { currentLink } from './url'
export function formatTime(seconds:number){const s=Math.max(0,Math.floor(seconds));return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`}
let fallbackCounter = 0

export function uid(): string {
  const webCrypto = typeof globalThis.crypto !== 'undefined' ? globalThis.crypto : undefined
  if (typeof webCrypto?.randomUUID === 'function') {
    return webCrypto.randomUUID()
  }

  const bytes = new Uint8Array(16)
  if (typeof webCrypto?.getRandomValues === 'function') {
    webCrypto.getRandomValues(bytes)
  } else {
    fallbackCounter += 1
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
    const seed = Date.now() ^ fallbackCounter
    bytes[0] ^= seed & 0xff
    bytes[1] ^= (seed >>> 8) & 0xff
    bytes[2] ^= (seed >>> 16) & 0xff
    bytes[3] ^= (seed >>> 24) & 0xff
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

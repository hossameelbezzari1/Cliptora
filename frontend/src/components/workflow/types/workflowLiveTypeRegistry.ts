/** CLIPTORA DTE V3: read live node contracts and statically check Canvas links. */
import { api } from '../../../lib/api'
export type WorkflowTypeStatus = 'compatible' | 'requires_mapping' | 'runtime_check' | 'unknown'

export type WorkflowTypePort = {
  path: string
  direction: 'input' | 'output'
  type: string
  required: boolean
  unit?: string | null
  semantic?: string | null
}

export type WorkflowTypeCatalogEntry = {
  node_type: string
  input_contract: Record<string, unknown>
  output_contract: Record<string, unknown>
  input_ports: WorkflowTypePort[]
  output_ports: WorkflowTypePort[]
  input_contract_id: string | null
  output_contract_id: string | null
  contract_status: 'declared' | 'undeclared'
}

export type WorkflowTypeCatalogResponse = {
  version: number
  nodes: WorkflowTypeCatalogEntry[]
  total_nodes: number
  declared_contract_nodes: number
}

export type WorkflowCompatibilityRequest = {
  source_type: string
  target_type: string
  source_path?: string
  target_path?: string
}

export type WorkflowCompatibilityResponse = {
  source_type: string
  target_type: string
  source_path: string
  target_path: string
  status: WorkflowTypeStatus
  issues: string[]
  unknowns?: string[]
}

function endpoint(baseUrl: string, route: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${route}`
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = payload && typeof payload === 'object' && 'detail' in payload
      ? (payload as { detail?: unknown }).detail
      : null
    const message = typeof detail === 'string' ? detail : `HTTP ${response.status}`
    throw new Error(message)
  }
  return payload as T
}

/** Call at screen load or on refresh; an updated Python module needs a backend reload. */
export async function fetchWorkflowTypeCatalog(
  baseUrl = '/api/v1',
  signal?: AbortSignal,
): Promise<WorkflowTypeCatalogResponse> {
  // Use CLIPTORA's authenticated API client for the normal application route.
  if (baseUrl === '/api/v1') return api<WorkflowTypeCatalogResponse>('/workflow-type-catalog', { signal })
  const response = await fetch(endpoint(baseUrl, 'workflow-type-catalog'), {
    method: 'GET',
    cache: 'no-store',
    credentials: 'include',
    signal,
  })
  return parseResponse<WorkflowTypeCatalogResponse>(response)
}

/** Unknown/runtime_check statuses require runtime verification; do not auto-convert. */
export async function checkWorkflowTypeConnection(
  request: WorkflowCompatibilityRequest,
  baseUrl = '/api/v1',
  signal?: AbortSignal,
): Promise<WorkflowCompatibilityResponse> {
  if (baseUrl === '/api/v1') return api<WorkflowCompatibilityResponse>('/workflow-type-compatibility', {
    method: 'POST', signal,
    body: JSON.stringify({
      source_type: request.source_type,
      target_type: request.target_type,
      source_path: request.source_path ?? '',
      target_path: request.target_path ?? '',
    }),
  })
  const response = await fetch(endpoint(baseUrl, 'workflow-type-compatibility'), {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_type: request.source_type,
      target_type: request.target_type,
      source_path: request.source_path ?? '',
      target_path: request.target_path ?? '',
    }),
    signal,
  })
  return parseResponse<WorkflowCompatibilityResponse>(response)
}

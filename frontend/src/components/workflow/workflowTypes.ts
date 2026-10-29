export type WorkflowNode = {
  id: string
  type: string
  depends_on: string[]
  when: 'always' | 'has_video' | 'has_transcript' | 'ai_enabled' | 'condition_true' | 'condition_false' | 'route_0' | 'route_1' | 'route_2' | 'route_3' | 'route_4' | 'route_fallback'
  settings: Record<string, unknown>
  position?: { x: number; y: number }
  retry_limit?: number
  cache?: boolean
}
export type WorkflowDefinition = { id: number; name: string; nodes: WorkflowNode[]; version?: number; updated_at?: string }
export type WorkflowVersion = { id: number; version: number; name: string; nodes: WorkflowNode[]; created_at: string }
export type WorkflowTemplate = { key: string; name: string; description: string; nodes: WorkflowNode[] }
export type WorkflowCatalogItem = {
  type: string; label: string; group: string; settings: Record<string, unknown>
  status?: 'implemented' | 'planned' | 'unavailable'; priority?: 'P0' | 'P1'; icon?: string
  actions?: string[]; input_types?: string[]; output_types?: string[]
  parameters_schema?: Record<string, unknown>; credentials?: string[]; backend_executor?: string | null
  description?: string; availability_reason?: string; source_package?: string; source_path?: string; source_license?: string; version?: string
}
export type WorkflowSource = { id: number; media_id: number | null; filename: string; size_bytes: number; created_at: string }
export type WorkflowRun = {
  id: number; workflow_id: number; source_id: number | null
  state: 'queued' | 'running' | 'cancelling' | 'cancelled' | 'completed' | 'failed'
  progress: number; current_node: string | null
  results: Record<string, { state: string; type: string; artifact?: boolean; [key: string]: unknown }>
  error: string | null; created_at: string
}

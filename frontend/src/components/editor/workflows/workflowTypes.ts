export type WorkflowNode = {
  id: string
  type: string
  depends_on: string[]
  when: 'always' | 'has_video' | 'has_transcript' | 'ai_enabled'
  settings: Record<string, unknown>
}
export type WorkflowDefinition = { id: number; name: string; nodes: WorkflowNode[]; updated_at?: string }
export type WorkflowTemplate = { key: string; name: string; description: string; nodes: WorkflowNode[] }
export type WorkflowCatalogItem = { type: string; label: string; group: string; settings: Record<string, unknown> }
export type WorkflowSource = { id: number; filename: string; size_bytes: number; created_at: string }
export type WorkflowRun = {
  id: number; workflow_id: number; source_id: number | null
  state: 'queued' | 'running' | 'cancelling' | 'cancelled' | 'completed' | 'failed'
  progress: number; current_node: string | null
  results: Record<string, { state: string; type: string; artifact?: boolean; [key: string]: unknown }>
  error: string | null; created_at: string
}

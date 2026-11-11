import type { WorkflowNodeUI } from './nodeTypes'
import { WorkflowRemixOutput } from './preview/WorkflowRemixOutput'

// Eager glob lets Vite discover newly created TSX modules at build time.
// Backend catalog still authorizes which types may appear or execute.
const modules = import.meta.glob<{ default: WorkflowNodeUI }>('./nodes/*.tsx', { eager: true })
const registered = new Map<string, WorkflowNodeUI>()
for (const [path, module] of Object.entries(modules)) {
  const plugin = module.default
  if (!plugin || typeof plugin.type !== 'string' || !plugin.type.trim()) {
    throw new Error(`Invalid workflow UI plugin: ${path}`)
  }
  if (registered.has(plugin.type)) {
    throw new Error(`Duplicate workflow UI plugin: ${plugin.type}`)
  }
  registered.set(plugin.type, plugin)
}

export function getNodeUI(type: string): WorkflowNodeUI | undefined {
  return registered.get(type) ?? (type.startsWith('video.remix_')
    ? { type, Output: WorkflowRemixOutput }
    : undefined)
}

export function registeredUINodeTypes(): string[] {
  return [...registered.keys()].sort()
}

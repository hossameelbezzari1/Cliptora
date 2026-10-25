import type { WorkflowNode } from './workflowTypes'

export const uid = (type: string, used: string[]) => {
  const base = type.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 25)
  let name = base
  let n = 2
  while (used.includes(name)) name = `${base}_${n++}`
  return name
}
export const clone = (nodes: WorkflowNode[]) => {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const memo = new Map<string, number>()
  const depth = (id: string, visiting = new Set<string>()): number => {
    if (memo.has(id)) return memo.get(id)!
    if (visiting.has(id)) return 0
    const node = byId.get(id)
    if (!node?.depends_on.length) return 0
    const next = new Set(visiting); next.add(id)
    const value = 1 + Math.max(...node.depends_on.map(dep => depth(dep, next)))
    memo.set(id, value); return value
  }
  const rows = new Map<number, number>()
  return nodes.map(node => {
    const column = depth(node.id)
    const row = rows.get(column) ?? 0
    rows.set(column, row + 1)
    return { ...node, settings: structuredClone(node.settings), depends_on: [...node.depends_on], position: node.position ?? { x: 120 + column * 190, y: 80 + row * 160 } }
  })
}
export const preferredNode = (nodes: WorkflowNode[]) => nodes.find(node => node.type === 'ai.highlights')?.id ?? nodes[0]?.id ?? null
export const errorMessage = (err: unknown) => err instanceof Error ? err.message : String(err)

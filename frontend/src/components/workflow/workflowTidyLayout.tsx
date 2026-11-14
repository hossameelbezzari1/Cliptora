import type { WorkflowNode } from './workflowTypes'

type Point = { x: number; y: number }
type Port = 'chat_model' | 'memory' | 'tool'
type Rectangle = { x: number; y: number; w: number; h: number }

const MAIN_X = 90
const MAIN_Y = 90
const MAIN_COLUMN = 270
const MAIN_ROW = 235
const NODE_W = 190
const NODE_H = 185
const TOOL_COLUMN = 230
const TOOL_ROW = 220
const TOOL_COLUMNS = 3
const PADDING = 32
const PIN_KEY = '__cliptora_ui_pinned'
const TARGET_HANDLES = '__cliptora_ui_target_handles'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readPort(value: unknown): Port | null {
  return value === 'chat_model' || value === 'memory' || value === 'tool' ? value : null
}

function inferredPort(type: string): Port | null {
  const normalized = type.toLowerCase()

  if (normalized === 'ai.chat_model' || /(?:^|[._-])chat[._-]?model(?:$|[._-])/.test(normalized)) {
    return 'chat_model'
  }

  if (/(?:^|[._-])memory(?:$|[._-])/.test(normalized)) {
    return 'memory'
  }

  // Browser automation includes Mouse Controller, page/element handles,
  // keyboard, Playwright and the rest of the tools connected to an agent.
  // These are only treated as agent children when an agent actually uses them.
  if (
    /^(?:browser[._-]|playwright[._-]|selenium[._-]|tools?[._-]|computer[._-]|ai[._-]tool)/.test(normalized) ||
    /(?:^|[._-])(?:mouse|pointer|cursor|keyboard|handle|handler|element|selector|click|scroll|drag|screenshot|browser|download|automation)(?:$|[._-])/.test(normalized)
  ) return 'tool'

  return null
}

function overlaps(first: Rectangle, second: Rectangle): boolean {
  return first.x < second.x + second.w + PADDING &&
    first.x + first.w + PADDING > second.x &&
    first.y < second.y + second.h + PADDING &&
    first.y + first.h + PADDING > second.y
}

function rect(position: Point): Rectangle {
  return { ...position, w: NODE_W, h: NODE_H }
}

function isPinned(node: WorkflowNode): boolean {
  return node.settings[PIN_KEY] === true && !!node.position
}

/**
 * Arrange CLIPTORA's executable DAG and its agent-only connections separately.
 * Connections and settings remain unchanged; only node.position is modified.
 */
export function tidyWorkflowNodes(nodes: WorkflowNode[]): WorkflowNode[] {
  if (!nodes.length) return nodes

  const byId = new Map(nodes.map(node => [node.id, node]))
  const order = new Map(nodes.map((node, i) => [node.id, i]))
  const consumers = new Map<string, string[]>()

  for (const node of nodes) {
    for (const dep of node.depends_on) {
      if (!byId.has(dep)) continue
      consumers.set(dep, [...(consumers.get(dep) ?? []), node.id])
    }
  }

  // The authoritative source is each agent's incoming handle mapping.
  // A Mouse/Browser tool can also depend on ANOTHER tool (e.g. browser
  // session -> commands -> mouse). We must keep the whole private tool
  // chain beneath its agent, not mistake upstream tools for main-flow nodes.
  const owner = new Map<string, { agentId: string; port: Port }>()

  for (const agent of nodes.filter(node => node.type === 'ai.agent')) {
    const savedHandles = agent.settings[TARGET_HANDLES]
    const handles = isRecord(savedHandles) ? savedHandles : {}
    const candidates = new Map<string, Port>()
    const visiting = new Set<string>()

    const collect = (id: string, portHint?: Port) => {
      const node = byId.get(id)
      if (!node || node.type === 'ai.agent' || visiting.has(id)) return

      const port = portHint ?? inferredPort(node.type)
      if (!port) return

      visiting.add(id)
      candidates.set(id, port)

      // Follow upstream browser/mouse/handle tools, even when these tools
      // do not connect directly to the AI Agent.
      for (const dependency of node.depends_on) {
        const source = byId.get(dependency)
        if (!source) continue
        const upstreamPort = inferredPort(source.type)
        if (upstreamPort) collect(source.id, upstreamPort)
      }

      visiting.delete(id)
    }

    for (const dependency of agent.depends_on) {
      const node = byId.get(dependency)
      if (!node) continue
      const port = readPort(handles[dependency]) ?? inferredPort(node.type)
      if (port) collect(dependency, port)
    }

    // Reject shared/external-use nodes, including tools feeding an ordinary
    // workflow step or another agent. Do this as a fixed-point check so an
    // upstream tool is also rejected if one of its descendants was rejected.
    let changed = true
    while (changed) {
      changed = false
      for (const id of [...candidates.keys()]) {
        const externallyUsed = (consumers.get(id) ?? []).some(consumerId =>
          consumerId !== agent.id && !candidates.has(consumerId),
        )
        if (externallyUsed) {
          candidates.delete(id)
          changed = true
        }
      }
    }

    for (const [id, port] of candidates) {
      // Shared resources stay in the normal DAG; never move the same node
      // under two different agents.
      if (!owner.has(id)) owner.set(id, { agentId: agent.id, port })
    }
  }

  const mainNodes = nodes.filter(node => !owner.has(node.id))
  const mainSet = new Set(mainNodes.map(node => node.id))
  const parents = new Map<string, string[]>()
  const children = new Map<string, string[]>()
  for (const node of mainNodes) {
    const deps = node.depends_on.filter(dep => mainSet.has(dep))
    parents.set(node.id, deps)
    for (const dep of deps) children.set(dep, [...(children.get(dep) ?? []), node.id])
  }

  // Put disconnected/unused nodes below the connected graph, not in its first layer.
  const isolated = new Set(mainNodes.filter(node =>
    node.type !== 'ai.agent' &&
    !(parents.get(node.id)?.length) && !(children.get(node.id)?.length),
  ).map(node => node.id))
  const connectedMain = mainNodes.filter(node => !isolated.has(node.id))

  const depths = new Map<string, number>()
  const active = new Set<string>()
  const depthOf = (id: string): number => {
    if (depths.has(id)) return depths.get(id)!
    if (active.has(id)) return 0 // Prevent recursion in malformed cyclic graphs.
    active.add(id)
    const deps = (parents.get(id) ?? []).filter(dep => !isolated.has(dep))
    const depth = deps.length ? 1 + Math.max(...deps.map(depthOf)) : 0
    active.delete(id)
    depths.set(id, depth)
    return depth
  }
  for (const node of connectedMain) depthOf(node.id)

  // Prefer the route with the largest downstream reach as the main/top lane.
  const downstream = new Map<string, number>()
  const downstreamVisiting = new Set<string>()
  const reach = (id: string): number => {
    if (downstream.has(id)) return downstream.get(id)!
    if (downstreamVisiting.has(id)) return 0
    downstreamVisiting.add(id)
    const next = children.get(id) ?? []
    const value = next.length ? 1 + Math.max(...next.map(reach)) : 0
    downstreamVisiting.delete(id)
    downstream.set(id, value)
    return value
  }
  for (const node of connectedMain) reach(node.id)

  const byDepth = new Map<number, WorkflowNode[]>()
  for (const node of connectedMain) {
    const depth = depths.get(node.id) ?? 0
    byDepth.set(depth, [...(byDepth.get(depth) ?? []), node])
  }

  const positions = new Map<string, Point>()
  const occupied: Rectangle[] = []
  for (const node of nodes) {
    if (!isPinned(node)) continue
    positions.set(node.id, node.position!)
    occupied.push(rect(node.position!))
  }

  const isClear = (point: Point) =>
    occupied.every(existing => !overlaps(rect(point), existing))

  const claim = (node: WorkflowNode, target: Point, step: number): Point => {
    if (isPinned(node)) return node.position!
    let candidate = target
    for (let attempt = 0; attempt < 500 && !isClear(candidate); attempt++) {
      candidate = { ...candidate, y: candidate.y + step }
    }
    positions.set(node.id, candidate)
    occupied.push(rect(candidate))
    return candidate
  }

  // Primary graph: topological columns, with sibling branches ordered locally.
  for (const level of [...byDepth.keys()].sort((a, b) => a - b)) {
    const group = byDepth.get(level)!
    group.sort((a, b) => {
      const priority = (node: WorkflowNode) => {
        const deps = parents.get(node.id) ?? []
        const knownParents = deps.map(dep => positions.get(dep)?.y).filter((v): v is number => v !== undefined)
        return knownParents.length
          ? knownParents.reduce((sum, y) => sum + y, 0) / knownParents.length
          : MAIN_Y
      }
      return priority(a) - priority(b) ||
        (downstream.get(b.id) ?? 0) - (downstream.get(a.id) ?? 0) ||
        (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)
    })
    group.forEach((node, index) => {
      if (isPinned(node)) return
      const base = { x: MAIN_X + level * MAIN_COLUMN, y: MAIN_Y + index * MAIN_ROW }
      claim(node, base, MAIN_ROW)
    })
  }

  // Agent children are a visual subgraph, not workflow-depth columns.
  // Model and memory occupy the first row; tools form compact three-item rows.
  for (const agent of mainNodes.filter(node => node.type === 'ai.agent')) {
    const anchor = positions.get(agent.id) ?? agent.position ?? { x: MAIN_X, y: MAIN_Y }
    const attached = nodes.filter(node => owner.get(node.id)?.agentId === agent.id)
    if (!attached.length) continue

    const core = attached.filter(node => owner.get(node.id)?.port !== 'tool')
      .sort((a, b) => (owner.get(a.id)?.port === 'chat_model' ? -1 : 1) -
        (owner.get(b.id)?.port === 'chat_model' ? -1 : 1) ||
        (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    const tools = attached.filter(node => owner.get(node.id)?.port === 'tool')
    const toolSet = new Set(tools.map(node => node.id))
    const toolDepths = new Map<string, number>()
    const visitingTools = new Set<string>()

    const toolDepth = (id: string): number => {
      if (toolDepths.has(id)) return toolDepths.get(id)!
      if (visitingTools.has(id)) return 0
      visitingTools.add(id)
      const parents = byId.get(id)?.depends_on.filter(dep => toolSet.has(dep)) ?? []
      const value = parents.length ? Math.max(...parents.map(toolDepth)) + 1 : 0
      visitingTools.delete(id)
      toolDepths.set(id, value)
      return value
    }

    tools.sort((a, b) => toolDepth(a.id) - toolDepth(b.id) ||
      (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))

    const rows: WorkflowNode[][] = []
    if (core.length) {
      for (let i = 0; i < core.length; i += TOOL_COLUMNS) rows.push(core.slice(i, i + TOOL_COLUMNS))
    }
    for (let i = 0; i < tools.length; i += TOOL_COLUMNS) rows.push(tools.slice(i, i + TOOL_COLUMNS))

    const startingY = anchor.y + MAIN_ROW + 36
    // Move the WHOLE agent group down if the shelf is occupied by another
    // agent's children, a branch, or a pinned node.
    let shiftY = 0
    const coordinates = (offsetY: number) => rows.flatMap((row, rowIndex) =>
      row.map((node, colIndex) => ({
        node,
        point: {
          x: anchor.x + (colIndex - (row.length - 1) / 2) * TOOL_COLUMN,
          y: startingY + rowIndex * TOOL_ROW + offsetY,
        },
      })),
    )

    for (let attempt = 0; attempt < 400; attempt++) {
      const candidates = coordinates(shiftY).filter(({ node }) => !isPinned(node))
      if (candidates.every(({ point }) => isClear(point))) break
      shiftY += TOOL_ROW
    }
    for (const { node, point } of coordinates(shiftY)) {
      if (!isPinned(node)) claim(node, point, TOOL_ROW)
    }
  }

  // Isolated nodes are kept visually separate from the main execution route.
  const bottom = Math.max(MAIN_Y, ...occupied.map(item => item.y + item.h)) + 170
  const orphanNodes = mainNodes.filter(node => isolated.has(node.id))
  orphanNodes.forEach((node, index) => {
    if (isPinned(node)) return
    claim(node, {
      x: MAIN_X + (index % 5) * MAIN_COLUMN,
      y: bottom + Math.floor(index / 5) * MAIN_ROW,
    }, MAIN_ROW)
  })

  return nodes.map(node => {
    const position = positions.get(node.id)
    return position ? { ...node, position } : node
  })
}

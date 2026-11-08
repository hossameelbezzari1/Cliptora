import { useMemo, useState } from 'react'
import type { WorkflowNode } from '../workflowTypes'
import type { WorkflowStudioState } from '../useWorkflowStudio'

type Kind = 'text' | 'media' | 'any'
type Choice = { path: string; label: string; kind: string; group: string }

type Props = {
  node: WorkflowNode
  studio?: WorkflowStudioState
  inputValue?: unknown
  kind: Kind
  value: string
  onChange: (path: string) => void
}

const fieldClass = 'block w-full min-w-0 rounded-lg border border-[#dedee3] dark:border-[#374151] bg-white dark:bg-cl-dark-panel px-3 py-2.5 text-[12px] text-[#303030] dark:text-[#f3f4f6] outline-none focus:ring-2 focus:ring-violet-100 dark:focus:ring-violet-900/70'
const blocked = /^(?:api_?key|access_token|refresh_token|password|secret|token|authorization)$/i
const mediaKey = /(?:audio|video|image|media|file|path|uri|url)$/i
const mediaValue = /(?:\.(?:wav|mp3|mp4|mov|m4a|aac|webm|png|jpe?g|gif|webp|pdf)(?:\?.*)?$|^https:\/\/)/i

const obj = (x: unknown): Record<string, unknown> =>
  x && typeof x === 'object' && !Array.isArray(x)
    ? x as Record<string, unknown>
    : {}

function collect(value: unknown, root: string, group: string, kind: Kind): Choice[] {
  const found: Choice[] = []
  const seen = new Set<string>()

  const add = (choice: Choice) => {
    if (seen.has(choice.path)) return
    seen.add(choice.path)
    found.push(choice)
  }

  const visit = (v: unknown, path: string, depth: number) => {
    if (depth > 4 || found.length >= 120 || v == null) return

    if (typeof v === 'string') {
      const key = path.split('.').slice(-1)[0] ?? ''
      const isMedia = mediaKey.test(key) && mediaValue.test(v)

      if (kind === 'media' ? isMedia : kind === 'text' ? !isMedia : true) {
        add({
          path,
          label: path.slice(root.length + 1),
          group,
          kind: kind === 'media' ? 'media' : 'text',
        })
      }
      return
    }

    if (Array.isArray(v)) {
      if (kind !== 'media') {
        add({
          path,
          label: path.slice(root.length + 1),
          group,
          kind: `array (${v.length})`,
        })
      }

      for (const sample of v
        .filter(item => item !== undefined && item !== null)
        .slice(0, 5)) {
        visit(sample, `${path}[]`, depth + 1)
      }
      return
    }

    if (typeof v !== 'object') {
      if (kind === 'any' || kind === 'text') {
        add({
          path,
          label: path.slice(root.length + 1),
          group,
          kind: typeof v,
        })
      }
      return
    }

    if (kind === 'text' && path.includes('[]')) {
      add({
        path,
        label: path.slice(root.length + 1),
        group,
        kind: 'json',
      })
    }

    for (const [key, child] of Object.entries(obj(v)).slice(0, 120)) {
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(key) || blocked.test(key)) continue
      visit(child, `${path}.${key}`, depth + 1)
    }
  }

  visit(value, root, 0)
  return found
}

export function WorkflowInputSelector({
  node, studio, inputValue, kind, value, onChange,
}: Props) {
  const [advanced, setAdvanced] = useState(false)

  const sources = useMemo(() => node.depends_on.map(id => {
    const upstream = studio?.nodes.find(item => item.id === id)
    const custom = upstream?.settings.__cliptora_ui_label
    const label = typeof custom === 'string' && custom.trim()
      ? custom.trim()
      : studio?.catalog.find(item => item.type === upstream?.type)?.label ?? id

    return { id, label }
  }), [node.depends_on, studio?.nodes, studio?.catalog])

  const options = useMemo(() => sources.flatMap(source =>
    collect(obj(inputValue)[source.id], source.id, source.label, kind)
  ), [sources, inputValue, kind])

  const groups = sources.map(source => ({
    ...source,
    fields: options.filter(item =>
      item.group === source.label &&
      item.path.startsWith(source.id + '.')
    ),
  }))

  const exists = options.some(option => option.path === value)

  return <section className="space-y-2">
    <label className="block text-[12px] font-medium text-[#3c3c3c] dark:text-[#f3f4f6]">
      Input data
    </label>

    <select
      aria-label="Select upstream input"
      className={fieldClass}
      value={value}
      onChange={event => onChange(event.target.value)}
    >
      <option value="">
        Auto ? detect connected {kind === 'media' ? 'media' : 'data'}
      </option>

      {value && !exists && (
        <option value={value}>Saved field: {value}</option>
      )}

      {groups.map(group =>
        group.fields.length > 0 && (
          <optgroup key={group.id} label={group.label}>
            {group.fields.map(option => (
              <option key={option.path} value={option.path}>
                {option.label} ? {option.kind}
              </option>
            ))}
          </optgroup>
        )
      )}
    </select>

    <p className="text-[11px] leading-4 text-[#858585] dark:text-[#b8bec7]">
      {sources.length === 0
        ? 'Connect an upstream node to receive its output automatically.'
        : options.length === 0
          ? 'Auto is enabled. Field choices appear after upstream execution data becomes available.'
          : 'Auto uses a compatible upstream output; choose a field only when needed.'}
    </p>

    <button
      type="button"
      className="text-[11px] text-violet-700 dark:text-violet-300 underline underline-offset-2"
      onClick={() => setAdvanced(open => !open)}
      aria-expanded={advanced}
    >
      {advanced ? 'Hide manual path' : 'Advanced: manual path'}
    </button>

    {advanced && (
      <input
        aria-label="Manual upstream field path"
        value={value}
        onChange={event => onChange(event.target.value)}
        className={`${fieldClass} font-mono`}
        placeholder="node_id.items[].value"
      />
    )}
  </section>
}

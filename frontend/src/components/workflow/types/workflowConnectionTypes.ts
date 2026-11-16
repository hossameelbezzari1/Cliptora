import type { DteSchema, DteAdapterRule } from './dteContracts'

export type DteLinkResult = {
  status: 'compatible' | 'requires_mapping' | 'unknown'
  issues: string[]
  sourcePath: string
  targetPath: string
}

/** Conservative UI preflight; backend Validation + TypeRuntime remain authoritative. */
export function previewTypedLink(
  source: DteSchema | undefined,
  target: DteSchema | undefined,
  sourcePath = '',
  targetPath = '',
): DteLinkResult {
  const issues: string[] = []
  let uncertain = false
  const seen = new Set<string>()

  function compare(from: DteSchema | undefined, to: DteSchema | undefined, path: string, depth = 0): void {
    if (depth > 8 || !from || !to) { uncertain = true; return }
    if (from.anyOf || to.anyOf || !from.type || !to.type) { uncertain = true; return }
    if (from.type !== to.type && !(from.type === 'integer' && to.type === 'number')) {
      issues.push(`${path}: ${from.type} → ${to.type}`)
      return
    }
    for (const tag of ['x-unit', 'x-semantic', 'x-contract-version'] as const) {
      if (to[tag] !== undefined && from[tag] !== to[tag]) issues.push(`${path}: ${tag} mismatch`)
    }
    if (to.type === 'object') {
      const produced = from.properties ?? {}
      const guaranteed = new Set(from.required ?? [])
      for (const field of to.required ?? []) {
        if (!(field in produced)) issues.push(`${path}.${field}: missing`)
        else if (!guaranteed.has(field)) uncertain = true
      }
      for (const [field, contract] of Object.entries(to.properties ?? {})) {
        if (produced[field] && !seen.has(`${path}.${field}`)) {
          seen.add(`${path}.${field}`)
          compare(produced[field], contract, `${path}.${field}`, depth + 1)
        }
      }
    }
    if (to.type === 'array') compare(from.items, to.items, `${path}[]`, depth + 1)
    if (to.enum || to.const !== undefined || to.minimum !== undefined || to.maximum !== undefined ||
        to.minLength !== undefined || to.maxLength !== undefined || to.additionalProperties !== undefined) uncertain = true
  }

  if (!source || !target || !Object.keys(source).length || !Object.keys(target).length) uncertain = true
  else compare(source, target, '$')
  return {
    status: issues.length ? 'requires_mapping' : uncertain ? 'unknown' : 'compatible',
    issues,
    sourcePath,
    targetPath,
  }
}

/** Do not construct adapters from names or guesses; only previously approved rules. */
export function approvedRuleForLink(
  rules: DteAdapterRule[],
  ruleId: string,
  version: number,
): DteAdapterRule | undefined {
  return rules.find(rule => rule.id === ruleId && rule.version === version)
}

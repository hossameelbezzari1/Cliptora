export type VariableType = 'string'|'number'|'boolean'|'color'|'date'|'datetime'|'duration'|'percentage'|'url'|'media'|'select'|'json'
export type VariableValue = {type: VariableType; value: unknown}
export type VariableMap = Record<string, VariableValue>
export function durationSeconds(value: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)\s*$/i.exec(value)
  if (!match) return null
  return Number(match[1]) * ({ms:.001,s:1,m:60,h:3600,d:86400}[match[2].toLowerCase() as 'ms'|'s'|'m'|'h'|'d'])
}
export function evaluateExpression(expression: string, variables: VariableMap, context: Record<string, unknown> = {}, clock = new Date()): unknown {
  const expr = expression.trim()
  const dateMatch = /^(now\(\)|today\(\)|[a-zA-Z_][\w.]*)\s*([+-])\s*(?:duration\(["']([^"']+)["']\)|([0-9.]+\s*(?:ms|s|m|h|d)))$/i.exec(expr)
  if (dateMatch) {
    const base = evaluateExpression(dateMatch[1],variables,context,clock)
    const seconds = durationSeconds(dateMatch[3] || dateMatch[4])
    if (seconds === null) return null
    if (typeof base === 'string' && !Number.isNaN(Date.parse(base))) return new Date(Date.parse(base) + (dateMatch[2] === '+' ? 1 : -1)*seconds*1000).toISOString()
    if (typeof base === 'number') return base + (dateMatch[2] === '+' ? 1 : -1)*seconds
    return null
  }
  if (expr === 'now()' || expr === 'system.now') return clock.toISOString()
  if (expr === 'today()' || expr === 'system.today') return clock.toISOString().slice(0,10)
  if (expr === 'true') return true
  if (expr === 'false') return false
  const durationMatch = /^duration\(["']([^"']+)["']\)$/.exec(expr)
  if (durationMatch) return durationSeconds(durationMatch[1])
  if (/^-?\d+(?:\.\d+)?$/.test(expr)) return Number(expr)
  if (/^[a-zA-Z_][\w.]*$/.test(expr)) return variables[expr]?.value ?? context[expr] ?? null
  return null
}
export function interpolateVariables(value: string, vars: VariableMap, context: Record<string,unknown> = {}, clock = new Date()): string {
  return value.replace(/\{\{([^{}]+)\}\}/g, (_whole, expr: string) => {
    const v=evaluateExpression(expr,vars,context,clock)
    return v == null ? '' : typeof v==='object' ? JSON.stringify(v) : String(v)
  })
}

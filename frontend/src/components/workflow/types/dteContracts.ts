/** Portable TypeScript description of the CLIPTORA Dynamic Type Engine V2.
 * JSON schemas and runtime results originate from the backend, not duplicated
 * hardcoded node definitions. Consumer-side checks are only UI hints.
 */
export type JsonScalar = string | number | boolean | null
export type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue }

export type DteSchema = {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'
  properties?: Record<string, DteSchema>
  required?: string[]
  items?: DteSchema
  additionalProperties?: boolean | DteSchema
  anyOf?: DteSchema[]
  enum?: JsonValue[]
  const?: JsonValue
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  'x-unit'?: string
  'x-semantic'?: string
  'x-contract-version'?: number
}

export type DteUnitConversion = {
  path: string
  from: 'ms' | 's' | 'milliseconds' | 'seconds' | 'minutes' | 'hz' | 'khz'
  to: 'ms' | 's' | 'milliseconds' | 'seconds' | 'minutes' | 'hz' | 'khz'
}

export type DteAdapterRule = {
  id: string
  version: number
  mapping: Record<string, string>
  conversions?: DteUnitConversion[]
  preserve_unmapped?: boolean
  source_schema?: DteSchema
  target_schema?: DteSchema
}

export type DteTypeSettings = {
  type_validation_mode?: 'legacy' | 'strict' | 'adapt' | 'auto'
  type_input_path?: string
  type_target_path?: string
  type_input_schema?: DteSchema
  type_output_schema?: DteSchema
  type_source_schema?: DteSchema
  type_adapter_rule?: DteAdapterRule
}

export type DteCompatibilityResult = {
  status: 'compatible' | 'convertible' | 'requires_mapping' | 'incompatible'
  auto_safe: boolean
  mapping: Record<string, string>
  issues: string[]
  requires_review: string[]
  semantic_issues: string[]
  missing_required?: string[]
  ambiguous?: string[]
}

export type DteDiscoveredOutput = {
  version: number
  schema?: DteSchema
  schema_id?: string
  collections?: Array<{ path: string; elements: number; item_schema: DteSchema }>
  schema_truncated?: boolean
  schema_skipped?: boolean
}



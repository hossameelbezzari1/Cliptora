
import type { WorkflowStudioState } from '../useWorkflowStudio'
import { WorkflowSchemaParameters } from './WorkflowSchemaParameters'
import { WorkflowMediaField } from './WorkflowMediaField'
import {
  WorkflowDynamicParameters,
  type DynamicParameterSchema,
} from './WorkflowDynamicParameters'

type Props = {
  studio: WorkflowStudioState
  inputValue?: unknown
  onManageCredentials?: () => void
  isManualTrigger: boolean
  hasAgentModel: boolean
}

function schemaProperties(
  value: unknown,
): Record<string, DynamicParameterSchema> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return {}
  }

  const properties = (
    value as Record<string, unknown>
  ).properties

  if (
    !properties ||
    typeof properties !== 'object' ||
    Array.isArray(properties)
  ) {
    return {}
  }

  return properties as Record<
    string,
    DynamicParameterSchema
  >
}

export function WorkflowNodeParameters({
  studio,
  inputValue,
  onManageCredentials,
  hasAgentModel,
}: Props) {
  const {
    selected,
    selectedCatalog,
    updateSelectedSetting,
  } = studio

  if (!selected) return null

  const properties = schemaProperties(
    selectedCatalog?.parameters_schema,
  )

  const mediaInputs = (
    selectedCatalog?.inputs ?? []
  ).filter(
    input => input.type === 'media',
  )

  const usesDynamicCollection = Object.values(
    properties,
  ).some(
    field => field.widget === 'collection',
  )

  const usesGenericMedia = mediaInputs.length > 0

  if (usesGenericMedia || usesDynamicCollection) {
    return (
      <div className="space-y-5 pb-6">
        {mediaInputs.map(input => (
          <WorkflowMediaField
            key={`${selected.id}:${input.name}`}
            input={input}
            studio={studio}
          />
        ))}

        <WorkflowDynamicParameters
          key={`${selected.id}:schema`}
          schema={properties}
          values={selected.settings}
          inputData={inputValue}
          exclude={['source_id']}
          onChange={updateSelectedSetting}
        />
      </div>
    )
  }

  return (
    <WorkflowSchemaParameters
      node={selected}
      catalog={selectedCatalog}
      studio={studio}
      inputValue={inputValue}
      onChange={updateSelectedSetting}
      hasAgentModel={hasAgentModel}
      onManageCredentials={onManageCredentials}
    />
  )
}

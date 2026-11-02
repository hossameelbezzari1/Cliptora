import { useRef } from 'react'
import { ScanSearch } from 'lucide-react'
import type { WorkflowNodeParametersProps, WorkflowNodeUI } from '../nodeTypes'
import { InspectVideoInput, InspectVideoOutput, InspectVideoParameters, InspectVideoSourceParameters } from '../InspectVideoPanels'
import { mediaName } from '../../editor/library/mediaLibraryUtils'

function Parameters({ node, onChange, studio }: WorkflowNodeParametersProps) {
  const uploadRef = useRef<HTMLInputElement>(null)
  return <div className="space-y-5" data-inspect-video-node>
    {studio && <InspectVideoSourceParameters
      sourceId={studio.sourceId}
      sources={studio.sources}
      mediaOptions={studio.editorMedia.filter(media => media.kind === 'video').map(media => ({ id: media.id, label: mediaName(media) }))}
      onSourceChange={studio.setSourceId}
      onMediaChange={id => { void studio.useMediaSource(id) }}
      onUpload={event => { void studio.upload(event) }}
      uploadRef={uploadRef}
      working={studio.working}
    />}
    <InspectVideoParameters settings={node.settings} onChange={onChange} />
  </div>
}

const node: WorkflowNodeUI = {
  type: 'media.probe',
  Icon: ScanSearch,
  Parameters,
  Input: InspectVideoInput,
  Output: InspectVideoOutput,
}

export default node

import { useRef } from 'react'
import { Film } from 'lucide-react'
import type { WorkflowNodeParametersProps, WorkflowNodeUI } from '../nodeTypes'
import { InspectVideoSourceParameters } from '../InspectVideoPanels'
import { mediaName } from '../../editor/library/mediaLibraryUtils'

function Parameters({ studio }: WorkflowNodeParametersProps) {
  const uploadRef = useRef<HTMLInputElement>(null)
  if (!studio) return <p className="text-xs text-[#888] dark:text-[#b8bec7]">Video source controls are unavailable without an active workflow.</p>
  return <div data-video-source-node>
    <InspectVideoSourceParameters
      sourceId={studio.sourceId}
      sources={studio.sources}
      mediaOptions={studio.editorMedia.filter(media => media.kind === 'video').map(media => ({ id: media.id, label: mediaName(media) }))}
      onSourceChange={studio.setSourceId}
      onMediaChange={id => { void studio.useMediaSource(id) }}
      onUpload={event => { void studio.upload(event) }}
      uploadRef={uploadRef}
      working={studio.working}
      isSourceNode
    />
  </div>
}

const node: WorkflowNodeUI = { type: 'core.video_source', Icon: Film, Parameters }
export default node

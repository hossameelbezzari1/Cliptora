import { useState } from 'react'
import type { WorkflowStudioState } from './useWorkflowStudio'
import { Background, Controls, MiniMap, ReactFlow, type Edge } from '@xyflow/react'
import { Copy, Download, FolderInput, Import, Maximize2, PanelBottom, PanelBottomClose, Plus, Trash2 } from 'lucide-react'
import { btn } from './workflowUI'
import { flowNodeTypes, type StudioFlowNode } from './WorkflowNodeCard'
import { WorkflowBottomDeck } from './WorkflowBottomDeck'

export function WorkflowCanvas({ studio, onOpenNode }: { studio: WorkflowStudioState; onOpenNode?: (id: string) => void }) {
  const {
    templates, openTemplate, flow, setActiveId, setVersions, setName, setNodes,
    setSelectedId, working, nodes, importInput, importWorkflow, exportWorkflow,
    activeId, duplicateDefinition, deleteDefinition, dropNode, flowNodes, flowEdges,
    connect, setJsonEditor, updateNode, removeNode, showToolLibrary,
  } = studio
  const [bottomOpen, setBottomOpen] = useState(false)

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#fbfbfa]">
      <div className="flex h-[54px] shrink-0 items-center gap-2 overflow-x-auto border-b border-[#e9e9e9] bg-white px-3 [scrollbar-width:none] sm:px-4">
        <label className="inline-flex shrink-0 items-center gap-2 text-[11px] text-[#71717a]">
          <FolderInput size={15} />
          <select
            aria-label="Workflow template"
            defaultValue=""
            onChange={event => { const template = templates.find(item => item.key === event.target.value); if (template) openTemplate(template); event.target.value = '' }}
            className="h-9 max-w-[155px] rounded-lg border border-[#e5e7eb] bg-white px-2 text-xs text-[#333] outline-none focus:border-violet-400"
          >
            <option value="">Choose template</option>
            {templates.map(template => <option key={template.key} value={template.key}>{template.name}</option>)}
          </select>
        </label>

        <button type="button" className={btn} onClick={() => { setActiveId(null); setVersions([]); setName('Untitled Workflow'); setNodes([]); setSelectedId(null) }} title="Create an empty workflow"><Plus size={14} /> New</button>
        <input ref={importInput} type="file" accept="application/json,.json" className="hidden" onChange={event => void importWorkflow(event)} />
        <button type="button" className={btn} onClick={() => importInput.current?.click()}><Import size={14} /> Import</button>
        <button type="button" className={btn} disabled={!nodes.length} onClick={exportWorkflow}><Download size={14} /> Export</button>
        <button type="button" className={`${btn} hidden sm:inline-flex`} disabled={working || !activeId} onClick={() => void duplicateDefinition()} title="Duplicate workflow"><Copy size={14} /></button>
        <button type="button" className={`${btn} hidden sm:inline-flex`} disabled={working || !activeId} onClick={() => void deleteDefinition()} title="Delete saved workflow"><Trash2 size={14} /></button>
        <div className="min-w-3 flex-1" />
        <button type="button" className={btn} onClick={() => setBottomOpen(open => !open)} title={bottomOpen ? 'Hide execution preview' : 'Show execution preview'}>
          {bottomOpen ? <PanelBottomClose size={16} /> : <PanelBottom size={16} />}
          <span className="hidden 2xl:inline">Execution</span>
        </button>
        <button type="button" className={btn} onClick={() => flow.current?.fitView()} title="Fit nodes"><Maximize2 size={15} /></button>
      </div>

      <div
        className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-[#fbfbfa] [&_.react-flow__attribution]:!hidden [&_.react-flow__controls]:!overflow-hidden [&_.react-flow__controls]:!rounded-xl [&_.react-flow__controls]:!border [&_.react-flow__controls]:!border-[#dedede] [&_.react-flow__controls]:!bg-white [&_.react-flow__controls]:!shadow-sm [&_.react-flow__controls-button]:!size-9 [&_.react-flow__controls-button]:!border-[#efefef] [&_.react-flow__controls-button]:!bg-white [&_.react-flow__controls-button]:!fill-[#222] [&_.react-flow__edge-path]:!stroke-[#b5b5b5] [&_.react-flow__edge-path]:!stroke-[1.8px] [&_.react-flow__node]:!border-0 [&_.react-flow__node]:!bg-transparent [&_.react-flow__node]:!shadow-none"
        onDragOver={event => event.preventDefault()}
        onDrop={dropNode}
      >
        <ReactFlow<StudioFlowNode, Edge>
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={flowNodeTypes}
          onInit={instance => { flow.current = instance }}
          onConnect={connect}
          onNodeClick={(_, node) => {
            setSelectedId(node.id)
            setJsonEditor(JSON.stringify(nodes.find(item => item.id === node.id)?.settings ?? {}, null, 2))
          }}
          onNodeDoubleClick={(_, node) => {
            setSelectedId(node.id)
            setJsonEditor(JSON.stringify(nodes.find(item => item.id === node.id)?.settings ?? {}, null, 2))
            onOpenNode?.(node.id)
          }}
          onNodeDragStop={(_, node) => updateNode(node.id, { position: node.position })}
          onEdgesDelete={deleted => deleted.forEach(edge => updateNode(edge.target, { depends_on: (nodes.find(node => node.id === edge.target)?.depends_on ?? []).filter(id => id !== edge.source) }))}
          onNodesDelete={deleted => deleted.forEach(node => removeNode(node.id))}
          fitView
          deleteKeyCode="Delete"
          colorMode="light"
        >
          <Background color="#d9dde2" gap={24} size={1} />
          <Controls showInteractive={false} />
          <MiniMap zoomable pannable className="!hidden !rounded-xl !border !border-[#ddd] !bg-white !shadow-sm 2xl:!block" nodeColor="#ded8ed" />
        </ReactFlow>
        {!nodes.length && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
            <div className="pointer-events-auto max-w-[300px] rounded-2xl border border-[#e7e7e7] bg-white px-6 py-7 shadow-sm">
              <div className="mx-auto mb-4 grid size-12 place-items-center rounded-xl border border-violet-200 bg-violet-50 text-violet-700"><Plus size={22} /></div>
              <h2 className="text-sm font-semibold text-[#252525]">Start your workflow</h2>
              <p className="mt-2 text-xs leading-5 text-[#858585]">Choose a tool from the left sidebar, or drag one onto the canvas.</p>
              <button type="button" onClick={showToolLibrary} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#222] px-4 py-2 text-xs font-semibold text-white hover:bg-[#444]"><Plus size={15} /> Add first tool</button>
            </div>
          </div>
        )}
      </div>
      {bottomOpen && <WorkflowBottomDeck studio={studio} />}
    </section>
  )
}

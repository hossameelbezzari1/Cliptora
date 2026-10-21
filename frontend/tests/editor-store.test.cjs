const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
let index = 0
const create = builder => {
  let state = {}
  const set = update => { const changed = typeof update === 'function' ? update(state) : update; state = { ...state, ...changed } }
  const get = () => state
  state = builder(set, get)
  const use = select => select(state)
  use.getState = get
  return use
}
const source = fs.readFileSync(`${__dirname}/../src/stores/editorStore.ts`, 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const moduleValue = { exports: {} }
vm.runInNewContext(code, { module: moduleValue, exports: moduleValue.exports,
  require(name) { if (name === 'zustand') return { create }; if (name === '../lib/api') return { uid: () => `id-${++index}` }; throw Error(name) },
  structuredClone, console, Math, Map, Set }, { filename: 'editorStore.js' })
const { useEditor } = moduleValue.exports
const s = () => useEditor.getState()
const media = { id: 1, name: 'movie.mp4', kind: 'video' }
const audio = { id: 2, name: 'sound.mp3', kind: 'audio' }
const image = { id: 3, name: 'picture.png', kind: 'image' }
s().hydrate(1, { revision: 1, tracks: [] })
assert.equal(s().tracks.length, 3, 'default three layers')
assert.equal(s().tracks[0].type, 'mixed')
const first = s().tracks[0].client_id
const second = s().tracks[1].client_id
assert.ok(s().addMediaClipAt(media, 10, first, 5))
const video = s().tracks[0].clips[0].client_id
assert.ok(s().addMediaClipAt(audio, 8, first, 15), 'mix audio/video same layer')
assert.ok(s().addMediaClipAt(image, 5, first, 23), 'mix image too')
assert.equal(s().tracks[0].clips.length, 3)
assert.equal(s().addMediaClipAt(image, 5, first, 6), false, 'overlap rejected')
assert.ok(s().moveClip(video, second, 5), 'move video to second layer')
assert.equal(s().tracks[1].clips.length, 1)
assert.ok(s().trimClip(video, 'right', 3, 30), 'extend right by dragging handle')
assert.equal(s().tracks[1].clips[0].duration, 13)
assert.ok(s().trimClip(video, 'left', 2, 30), 'trim left changes start and source offset')
assert.equal(s().tracks[1].clips[0].start, 7)
assert.equal(s().tracks[1].clips[0].duration, 11)
assert.equal(s().tracks[1].clips[0].source_offset, 2)
assert.ok(s().moveClip(video, null, 30), 'drag below creates layer')
assert.equal(s().tracks.length, 4)
assert.equal(s().tracks[0].clips[0].client_id, video)
assert.ok(s().addTextClipAt(second, 24), 'add text into second mixed layer')
const title = s().tracks.find(t => t.client_id === second).clips.at(-1).client_id
assert.ok(s().trimClip(title, 'left', -2, 30), 'text clip can extend left without media offset')
const textAfterTrim = s().tracks.find(t => t.client_id === second).clips.find(c => c.client_id === title)
assert.equal(textAfterTrim.start, 22)
assert.equal(textAfterTrim.duration, 7)
assert.equal(textAfterTrim.source_offset, 0)
assert.ok(s().renameTrack(first, 'Footage') === undefined)
assert.equal(s().tracks.find(t => t.client_id === first).name, 'Footage')
assert.ok(s().past.length > 0)
const beforeUndo = s().tracks.length
s().undo()
assert.equal(s().tracks.length, beforeUndo)
s().redo()
assert.equal(s().tracks.length, beforeUndo)
console.log('editor store tests: 20 scenarios passed')
// V2.4 clip context + interactive preview properties
const beforeLayers = s().tracks.length
const firstLayerId = s().tracks[1].client_id
const colorLayer = s().tracks.find(t => t.client_id === firstLayerId)
s().patchTrack(firstLayerId, { background_color: '#336699' })
assert.equal(s().tracks.find(t => t.client_id === firstLayerId).background_color, '#336699')
s().duplicateTrack(firstLayerId)
assert.equal(s().tracks.length, beforeLayers + 1)
assert.equal(s().tracks[2].name.endsWith('copy'), true)
const videoClip = s().tracks.flatMap(t => t.clips).find(c => c.type === 'video')
assert.ok(videoClip)
s().patchProps(videoClip.client_id, { x: 12.5, width: 45, rotation: -30, scale: 1.3 })
const edited = s().tracks.flatMap(t => t.clips).find(c => c.client_id === videoClip.client_id)
assert.equal(edited.props.x, 12.5)
assert.equal(edited.props.width, 45)
assert.equal(edited.props.rotation, -30)
s().duplicateClip(edited.client_id)
assert.equal(s().tracks.flatMap(t=>t.clips).filter(c=>c.name.endsWith('copy')).length>0,true)
const visual = s().tracks.flatMap(t=>t.clips).find(c => c.client_id === videoClip.client_id)
s().patchClip(visual.client_id, { locked:true })
const lockedStart = s().tracks.flatMap(t => t.clips).find(c => c.client_id === visual.client_id).start
assert.equal(s().moveClip(visual.client_id, firstLayerId, 100), false)
s().patchClip(visual.client_id, { locked:false })
assert.equal(s().tracks.flatMap(t=>t.clips).find(c=>c.client_id===visual.client_id).start, lockedStart)
s().detachAudio(visual.client_id)
const detached = s().tracks.flatMap(t=>t.clips).find(c=>c.props?.attached_to===visual.client_id)
assert.ok(detached)
assert.equal(detached.type, 'audio')
assert.equal(s().tracks.flatMap(t=>t.clips).find(c=>c.client_id===visual.client_id).props.audio_muted,true)
s().mergeAudio(detached.client_id)
assert.equal(s().tracks.flatMap(t=>t.clips).some(c=>c.client_id===detached.client_id),false)
assert.equal(s().tracks.flatMap(t=>t.clips).find(c=>c.client_id===visual.client_id).props.audio_muted,false)
const splitCandidate=s().tracks.flatMap(t=>t.clips).find(c=>c.client_id===visual.client_id)
assert.equal(s().splitClip(splitCandidate.client_id, splitCandidate.start + splitCandidate.duration/2),true)
const splitFragments=s().tracks.flatMap(t=>t.clips).filter(c=>c.media_id===splitCandidate.media_id)
assert.ok(splitFragments.length>1)
const cuttable=splitFragments.find(c=>c.client_id!==visual.client_id)
s().cutClip(cuttable.client_id)
assert.equal(s().clipboard.name,cuttable.name)
assert.equal(s().tracks.flatMap(t=>t.clips).some(c=>c.client_id===cuttable.client_id),false)
console.log('editor store tests: V2.4 context/transform/split/audio scenarios passed')

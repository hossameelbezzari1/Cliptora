const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '../src/components/editor/preview/previewGeometry.ts'), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const exportsFromGeometry = {}
new Function('exports', 'require', js)(exportsFromGeometry, require)
const { getObjectTransform, getTransformDelta, resetTransform } = exportsFromGeometry
const fakeClip = { type: 'video', props: { x: 14, rotation: 20, scale: 1.3 } }

test('image and video objects default to whole canvas; text objects start with a smaller selection frame', () => {
  assert.deepEqual([getObjectTransform({ type: 'video' }).width, getObjectTransform({ type: 'image' }).height], [100, 100])
  const text = getObjectTransform({ type: 'text' })
  assert.deepEqual([text.x, text.y, text.width, text.height], [20, 35, 60, 22])
})

test('saved clip transform and drag preview merge without dropping other properties', () => {
  const result = getObjectTransform(fakeClip, { x: 40, width: 70 })
  assert.deepEqual([result.x, result.width, result.rotation, result.scale], [40, 70, 20, 1.3])
})

test('dragging a preview object changes only its X and Y percentages', () => {
  const gesture = { tool: 'move', startX: 100, startY: 100, centerX: 300, centerY: 200, initialAngle: 0, initial: getObjectTransform(fakeClip) }
  assert.deepEqual(getTransformDelta(gesture, 150, 75, 500, 250), { x: 24, y: -10 })
})

test('resize uses canvas scale and changes width/height only', () => {
  const gesture = { tool: 'resize', startX: 0, startY: 0, centerX: 0, centerY: 0, initialAngle: 0, initial: getObjectTransform(fakeClip) }
  assert.deepEqual(getTransformDelta(gesture, 50, 25, 500, 250), { width: 107.7, height: 107.7 })
})

test('scale uses distance from center and rotation uses angle around center', () => {
  const initial = getObjectTransform({ type: 'text', props: { scale: 1 } })
  const common = { startX: 110, startY: 100, centerX: 100, centerY: 100, initialAngle: 0, initial }
  assert.equal(getTransformDelta({ ...common, tool: 'scale' }, 120, 100, 500, 300).scale, 2)
  assert.equal(getTransformDelta({ ...common, tool: 'rotate' }, 100, 110, 500, 300).rotation, 90)
})

test('reset values stay normalized to the canvas', () => {
  assert.deepEqual([resetTransform.x, resetTransform.y, resetTransform.width, resetTransform.height, resetTransform.scale, resetTransform.rotation], [0, 0, 100, 100, 1, 0])
})

test('crop can hide left, top, right and bottom edges without exceeding the visible source', () => {
  const { calculateCropMargin } = exportsFromGeometry
  assert.equal(calculateCropMargin('left', 0, 0, 10, 100), 10)
  assert.equal(calculateCropMargin('right', 0, 0, -10, 100), 10)
  assert.equal(calculateCropMargin('top', 15, 0, 20, 100), 35)
  assert.equal(calculateCropMargin('bottom', 0, 0, -20, 100), 20)
  assert.equal(calculateCropMargin('left', 80, 12, 50, 100), 83)
  assert.equal(calculateCropMargin('right', 5, 90, -25, 100), 5)
  assert.equal(calculateCropMargin('left', 20, 10, -80, 100), 0)
})

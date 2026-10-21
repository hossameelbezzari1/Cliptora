const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const srcRoot = path.resolve(__dirname, '../src')
const catalog = fs.readFileSync(path.resolve(srcRoot, 'lib/catalog.ts'), 'utf8')
const cards = fs.readFileSync(path.resolve(srcRoot, 'components/editor/library/ComponentThumbnail.tsx'), 'utf8')
const library = fs.readFileSync(path.resolve(srcRoot, 'components/editor/library/SmartLibrary.tsx'), 'utf8')

test('Every built-in shape is still declared in catalogue', () => {
  for (const name of ['Text', 'Rectangle', 'Square', 'Circle', 'Ellipse', 'Triangle', 'Line', 'Arrow', 'Star', 'Polygon', 'Blur Box', 'Directional Blur Box', 'Mosaic Blur Box']) {
    assert.ok(catalog.includes(`'${name}'`), `${name} missing from catalogue`)
  }
})

test('Visual component cards render real SVG shapes, text and portrait previews', () => {
  for (const name of ['Rectangle', 'Square', 'Circle', 'Ellipse', 'Triangle', 'Line', 'Arrow', 'Star', 'Polygon']) assert.ok(cards.includes(`name === '${name}'`), `${name} needs a shape preview`)
  assert.match(cards, /name === 'Text'/)
  assert.match(cards, /<svg viewBox=/)
  assert.match(cards, /SavedComponentThumbnail/)
})

test('All 3 photographic blur assets are valid, optimized WebP images', () => {
  const root = path.resolve(__dirname, '../public/assets/components')
  for (const mode of ['gaussian', 'directional', 'mosaic']) {
    const name = `blur-${mode}.webp`
    assert.ok(cards.includes(name), `${name} not connected to a component`)
    const data = fs.readFileSync(path.join(root, name))
    assert.equal(data.subarray(0, 4).toString(), 'RIFF')
    assert.equal(data.subarray(8, 12).toString(), 'WEBP')
    assert.ok(data.length > 1000 && data.length < 120_000, `${name} size suspicious`)
  }
})

test('Search, category filters, layout modes and existing saving actions remain', () => {
  for (const token of ['Search components...', 'componentCategory', 'componentView', 'cardSize', 'Save selected clip', "save('folder'", "save('component'", 'addShape(shape)']) {
    assert.ok(library.includes(token), `${token} missing`)
  }
})

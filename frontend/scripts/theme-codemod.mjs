import { readdir, readFile, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../src/', import.meta.url))
const extensions = new Set(['.ts', '.tsx'])

const tokenPairs = new Map([
  ['bg-cl-bg', 'bg-cl-bg dark:bg-cl-dark-bg'],
  ['bg-cl-panel', 'bg-cl-panel dark:bg-cl-dark-panel'],
  ['bg-cl-panel-2', 'bg-cl-panel-2 dark:bg-cl-dark-panel-2'],
  ['border-cl-line', 'border-cl-line dark:border-cl-dark-line'],
  ['bg-cl-line', 'bg-cl-line dark:bg-cl-dark-line'],
  ['text-cl-muted', 'text-cl-muted dark:text-cl-dark-muted'],
])

const semanticDark = {
  red: { bg: 'red-950/40', text: 'red-300', border: 'red-900/70', ring: 'red-900/70' },
  rose: { bg: 'rose-950/40', text: 'rose-300', border: 'rose-900/70', ring: 'rose-900/70' },
  amber: { bg: 'amber-950/35', text: 'amber-300', border: 'amber-900/70', ring: 'amber-900/70' },
  yellow: { bg: 'yellow-950/35', text: 'yellow-300', border: 'yellow-900/70', ring: 'yellow-900/70' },
  green: { bg: 'green-950/35', text: 'green-300', border: 'green-900/70', ring: 'green-900/70' },
  emerald: { bg: 'emerald-950/35', text: 'emerald-300', border: 'emerald-900/70', ring: 'emerald-900/70' },
  blue: { bg: 'blue-950/40', text: 'blue-300', border: 'blue-900/70', ring: 'blue-900/70' },
  indigo: { bg: 'indigo-950/40', text: 'indigo-300', border: 'indigo-900/70', ring: 'indigo-900/70' },
  violet: { bg: 'violet-950/40', text: 'violet-300', border: 'violet-900/70', ring: 'violet-900/70' },
  purple: { bg: 'purple-950/40', text: 'purple-300', border: 'purple-900/70', ring: 'purple-900/70' },
}

function expandHex(value) {
  const clean = value.replace('#', '').split('/')[0]
  if (clean.length === 3 || clean.length === 4) {
    return clean.split('').map(char => char + char).join('')
  }
  return clean
}

function rgb(hex) {
  const value = expandHex(hex)
  return [0, 2, 4].map(index => Number.parseInt(value.slice(index, index + 2), 16))
}

function luminance(channels) {
  const linear = channels.map(value => {
    const channel = value / 255
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  })
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2])
}

function mix(channels, target, amount) {
  return `#${channels.map(value => Math.round(value + ((target - value) * amount)).toString(16).padStart(2, '0')).join('')}`
}

function withVariants(variants, utility) {
  return `${variants}${utility}`
}

function darkVariant(variants, utility) {
  return `dark:${variants}${utility}`
}

function pair(variants, lightUtility, darkUtility) {
  return `${withVariants(variants, lightUtility)} ${darkVariant(variants, darkUtility)}`
}

function mapProjectToken(variants, property, value) {
  const utility = `${property}-${value}`
  const mapped = tokenPairs.get(utility)
  if (!mapped) return withVariants(variants, utility)
  const [light, dark] = mapped.split(' ')
  return pair(variants, light, dark.replace('dark:', ''))
}

function mapNamedNeutral(variants, property, family, shadeWithOpacity) {
  const [shadeText, opacity] = shadeWithOpacity.split('/')
  const shade = Number(shadeText)
  const original = `${property}-${family}-${shadeWithOpacity}`
  const suffix = opacity ? `/${opacity}` : ''

  if (property === 'bg') {
    if (shade <= 100) return pair(variants, original, `bg-${family}-900${suffix}`)
    if (shade <= 300) return pair(variants, original, `bg-${family}-800${suffix}`)
    if (shade >= 700) return pair(variants, `bg-${family}-50${suffix}`, original)
    return pair(variants, original, `bg-${family}-800${suffix}`)
  }

  if (property === 'text' || property === 'fill' || property === 'stroke') {
    if (shade >= 700) return pair(variants, original, `${property}-${family}-100${suffix}`)
    if (shade <= 300) return pair(variants, `${property}-${family}-700${suffix}`, original)
    return pair(variants, original, `${property}-${family}-300${suffix}`)
  }

  if (property === 'border' || property === 'ring' || property === 'outline') {
    if (shade <= 300) return pair(variants, original, `${property}-${family}-700${suffix}`)
    if (shade >= 600) return pair(variants, `${property}-${family}-200${suffix}`, original)
    return pair(variants, original, `${property}-${family}-600${suffix}`)
  }

  return withVariants(variants, original)
}

function mapSemantic(variants, property, family, shadeWithOpacity) {
  const shade = Number(shadeWithOpacity.split('/')[0])
  const original = `${property}-${family}-${shadeWithOpacity}`
  const dark = semanticDark[family]?.[property]
  if (!dark) return withVariants(variants, original)

  if (property === 'bg' && shade <= 100) return pair(variants, original, `bg-${dark}`)
  if ((property === 'text' || property === 'fill' || property === 'stroke') && shade >= 600) {
    return pair(variants, original, `${property}-${dark}`)
  }
  if ((property === 'border' || property === 'ring' || property === 'outline') && shade <= 300) {
    return pair(variants, original, `${property}-${dark}`)
  }
  return withVariants(variants, original)
}

function mapArbitrary(variants, property, rawValue) {
  const original = `${property}-[${rawValue}]`
  const hex = rawValue.split('/')[0]
  const normalized = expandHex(hex)
  if (normalized.length !== 6) return withVariants(variants, original)

  const channels = rgb(hex)
  const lightness = luminance(channels)
  const chroma = Math.max(...channels) - Math.min(...channels)
  const neutral = chroma <= 30

  if (property === 'bg') {
    if (neutral && lightness >= 0.62) return pair(variants, original, 'bg-[#1f2937]')
    if (neutral && lightness <= 0.28) return pair(variants, 'bg-[#f8fafc]', original)
    if (!neutral && lightness >= 0.72) return pair(variants, original, `bg-[${mix(channels, 0, 0.68)}]`)
    if (!neutral && lightness <= 0.18) return pair(variants, `bg-[${mix(channels, 255, 0.9)}]`, original)
    return withVariants(variants, original)
  }

  if (property === 'text' || property === 'fill' || property === 'stroke') {
    if (neutral && lightness <= 0.28) return pair(variants, original, `${property}-[#f3f4f6]`)
    if (neutral && lightness >= 0.62) return pair(variants, `${property}-[#4b5563]`, original)
    if (!neutral && lightness <= 0.22) return pair(variants, original, `${property}-[${mix(channels, 255, 0.58)}]`)
    if (!neutral && lightness >= 0.68) return pair(variants, `${property}-[${mix(channels, 0, 0.45)}]`, original)
    return withVariants(variants, original)
  }

  if (property === 'border' || property === 'ring' || property === 'outline') {
    if (neutral && lightness >= 0.52) return pair(variants, original, `${property}-[#374151]`)
    if (neutral && lightness <= 0.28) return pair(variants, `${property}-[#d1d5db]`, original)
    if (!neutral && lightness >= 0.68) return pair(variants, original, `${property}-[${mix(channels, 0, 0.55)}]`)
    if (!neutral && lightness <= 0.2) return pair(variants, `${property}-[${mix(channels, 255, 0.78)}]`, original)
  }

  return withVariants(variants, original)
}

function mapColorToken(match, variants = '', property, value) {
  if (variants.includes('dark:')) return match

  if (value.startsWith('cl-')) return mapProjectToken(variants, property, value)

  if (value === 'white') {
    if (property === 'bg') return pair(variants, 'bg-white', 'bg-cl-dark-panel')
    if (property === 'border' || property === 'ring' || property === 'outline') {
      return pair(variants, `${property}-white`, `${property}-cl-dark-line`)
    }
    return match
  }

  if (value === 'black') {
    if (property === 'text') return pair(variants, 'text-gray-900', 'text-white')
    return match
  }

  if (value.startsWith('[#')) return mapArbitrary(variants, property, value.slice(1, -1))

  const named = value.match(/^([a-z]+)-(\d{2,3}(?:\/\d+)?)$/)
  if (!named) return match
  const [, family, shade] = named
  if (['gray', 'slate', 'zinc', 'neutral', 'stone'].includes(family)) {
    return mapNamedNeutral(variants, property, family, shade)
  }
  if (family in semanticDark) return mapSemantic(variants, property, family, shade)
  return match
}

const colorToken = /((?:(?!dark:)[a-z-]+:)*)(bg|text|border|ring|outline|fill|stroke)-(cl-[\w-]+|white|black|(?:gray|slate|zinc|neutral|stone|red|rose|amber|yellow|green|emerald|blue|indigo|violet|purple)-\d{2,3}(?:\/\d+)?|\[#[0-9a-fA-F]{3,8}(?:\/\d+)?\])/g

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await collect(path))
    else if (extensions.has(extname(entry.name))) files.push(path)
  }
  return files
}

let changed = 0
for (const file of await collect(root)) {
  const source = await readFile(file, 'utf8')
  const next = source.replace(colorToken, mapColorToken)
  if (next !== source) {
    await writeFile(file, next)
    changed += 1
  }
}

console.log(`Updated ${changed} theme-aware source files.`)

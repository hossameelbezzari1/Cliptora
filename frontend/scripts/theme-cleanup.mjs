import { readdir, readFile, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../src/', import.meta.url))

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await collect(path))
    else if (['.ts', '.tsx'].includes(extname(entry.name))) files.push(path)
  }
  return files
}

function hexLuminance(hex) {
  const clean = hex.slice(1)
  const expanded = clean.length === 3
    ? clean.split('').map(char => char + char).join('')
    : clean
  const channels = [0, 2, 4].map(index => Number.parseInt(expanded.slice(index, index + 2), 16) / 255)
  const linear = channels.map(channel => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4)
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2])
}

function hexChannels(hex) {
  const clean = hex.slice(1)
  const expanded = clean.length === 3
    ? clean.split('').map(char => char + char).join('')
    : clean
  return [0, 2, 4].map(index => Number.parseInt(expanded.slice(index, index + 2), 16))
}

function mixHex(channels, target, amount) {
  return `#${channels.map(value => Math.round(value + ((target - value) * amount)).toString(16).padStart(2, '0')).join('')}`
}

function isPairedAfter(source, offset, match) {
  return /^\s+dark:/.test(source.slice(offset + match.length, offset + match.length + 90))
}

let changed = 0
for (const file of await collect(root)) {
  const source = await readFile(file, 'utf8')
  let next = source

  next = next.replace(
    /dark:((?:[a-z-]+:)*)text-gray-900(\/\d+)? dark:dark:\1text-white\2/g,
    'dark:$1text-white$2',
  )

  // Preserve opacity on light-mode overlays that were originally dark translucent fills.
  next = next.replace(
    /bg-\[#f8fafc\] dark:bg-(\[#[0-9a-fA-F]{6}\])(\/\d+)/g,
    'bg-[#f8fafc]$2 dark:bg-$1$2',
  )

  // Semantic colors that were authored for a dark canvas get a darker light-mode value.
  next = next.replace(
    /(^|[\s'"`])((?:[a-z-]+:)*)(bg|text|border)-(red|rose|amber|yellow|green|emerald|blue|indigo|violet|purple)-(\d{2,3})(\/\d+)?/gm,
    (match, boundary, variants, property, family, shadeText, opacity = '', offset, sourceText) => {
      if (variants.includes('dark:') || isPairedAfter(sourceText, offset, match)) return match
      const shade = Number(shadeText)
      const original = `${variants}${property}-${family}-${shadeText}${opacity}`
      if (property === 'text' && shade <= 400) {
        return `${boundary}${variants}text-${family}-700 dark:${original}`
      }
      if (property === 'bg' && shade >= 800) {
        return `${boundary}${variants}bg-${family}-50${opacity} dark:${original}`
      }
      if (property === 'border' && shade >= 600) {
        return `${boundary}${variants}border-${family}-200${opacity} dark:${original}`
      }
      return match
    },
  )

  // Pair any remaining neutral arbitrary utility that changes contrast between themes.
  next = next.replace(
    /(^|[\s'"`])((?:[a-z-]+:)*)(bg|text|border|ring|outline|fill|stroke)-\[(#[0-9a-fA-F]{3,6})\](\/\d+)?/gm,
    (match, boundary, variants, property, hex, opacity = '', offset, sourceText) => {
      if (variants.includes('dark:') || isPairedAfter(sourceText, offset, match)) return match
      const channels = hexChannels(hex)
      const chroma = Math.max(...channels) - Math.min(...channels)
      const lightness = hexLuminance(hex)
      const original = `${variants}${property}-[${hex}]${opacity}`

      if (chroma > 30) {
        if (property === 'text' || property === 'fill' || property === 'stroke') {
          const lightColor = lightness >= 0.28 ? mixHex(channels, 0, 0.38) : hex
          const darkColor = lightness < 0.48 ? mixHex(channels, 255, 0.42) : hex
          return `${boundary}${variants}${property}-[${lightColor}]${opacity} dark:${variants}${property}-[${darkColor}]${opacity}`
        }
        if (property === 'border' || property === 'ring' || property === 'outline') {
          const lightColor = lightness >= 0.5 ? mixHex(channels, 0, 0.25) : hex
          const darkColor = lightness < 0.4 ? mixHex(channels, 255, 0.28) : hex
          return `${boundary}${variants}${property}-[${lightColor}]${opacity} dark:${variants}${property}-[${darkColor}]${opacity}`
        }
        return match
      }

      if ((property === 'text' || property === 'fill' || property === 'stroke') && lightness >= 0.18) {
        return `${boundary}${variants}${property}-[#4b5563] dark:${original}`
      }
      if (property === 'bg' && lightness > 0.28 && lightness < 0.62) {
        return `${boundary}${variants}bg-[#eef2f7]${opacity} dark:${original}`
      }
      if ((property === 'border' || property === 'ring' || property === 'outline') && lightness > 0.28 && lightness < 0.52) {
        return `${boundary}${variants}${property}-[#d1d5db]${opacity} dark:${original}`
      }
      return match
    },
  )

  // A light surface cannot keep a white foreground; retain white only in dark mode.
  next = next.split('\n').map(line => {
    const hasLightSurface = /bg-(?:\[#f8fafc\]|cl-panel(?:-2)?) dark:bg-/.test(line)
    if (!hasLightSurface) return line
    return line.replace(/(?<!dark:)text-white/g, 'text-gray-900 dark:text-white')
  }).join('\n')

  // Legacy editor headings inherited a dark parent. Pair them unless the same
  // element is an intentional brand, gradient, black media, or drop-shadow surface.
  next = next.split('\n').map(line => {
    if (!/(?<!dark:)(?:[a-z-]+:)*text-white(?:\/\d+)?/.test(line)) return line
    const intentionalWhite = /(?:bg-cl-purple|bg-black(?:\/|\b)|bg-(?:red|rose|amber|green|emerald|blue|indigo|violet|purple)-[4-9]|bg-gradient|from-\[|to-\[|drop-shadow)/.test(line)
    if (intentionalWhite) return line
    return line.replace(
      /(?<!dark:)((?:[a-z-]+:)*)text-white(\/\d+)?/g,
      (match, variants, opacity = '') => variants.includes('dark:')
        ? match
        : `${variants}text-gray-900${opacity} dark:${variants}text-white${opacity}`,
    )
  }).join('\n')

  // Keep secondary copy secondary instead of promoting every legacy gray to white.
  next = next.replace(
    /text-\[(#[0-9a-fA-F]{3,6})\] dark:text-\[#f3f4f6\]/g,
    (match, hex) => hexLuminance(hex) >= 0.055
      ? `text-[${hex}] dark:text-[#b8bec7]`
      : match,
  )

  // Important/nested Tailwind utilities need their dark counterpart on the same target.
  next = next.replace(
    /(\[(?:&|@)[^\s'"`]+\]:!bg-white)(?![^\s'"`]*dark:)/g,
    match => `${match} dark:${match.replace('!bg-white', '!bg-cl-dark-panel')}`,
  )

  if (next !== source) {
    await writeFile(file, next)
    changed += 1
  }
}

console.log(`Cleaned ${changed} theme-aware source files.`)

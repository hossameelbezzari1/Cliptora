import type { ReactNode } from 'react'
import {
  AudioLines, Bot, CalendarClock, CheckCheck, Clapperboard, Code2,
  Database, FileJson2, FileSpreadsheet, Film, GitBranch, Globe2,
  ListFilter, Mail, MousePointerClick, Music2, Scissors, Sparkles,
  Split, Subtitles, Video, Workflow, Zap,
} from 'lucide-react'

type WorkflowToolIconProps = {
  type: string
  label?: string
  size?: number
}

type Brand = { test: RegExp; letter: string; background: string; foreground: string }

const OTHER_BRANDS: Brand[] = [
  { test: /gemini/, letter: '✦', background: '#796bdf', foreground: '#fff' },
  { test: /anthropic|claude/, letter: 'A', background: '#d87859', foreground: '#fff' },
  { test: /openai|chatgpt/, letter: '◎', background: '#181818', foreground: '#fff' },
  { test: /telegram/, letter: '➤', background: '#229ed9', foreground: '#fff' },
  { test: /notion/, letter: 'N', background: '#171717', foreground: '#fff' },
  { test: /slack/, letter: 'S', background: '#4a154b', foreground: '#fff' },
  { test: /youtube/, letter: '▶', background: '#f03', foreground: '#fff' },
  { test: /discord/, letter: 'D', background: '#5865f2', foreground: '#fff' },
  { test: /dropbox/, letter: 'D', background: '#0061ff', foreground: '#fff' },
  { test: /figma/, letter: 'F', background: '#242424', foreground: '#fff' },
  { test: /python/, letter: 'Py', background: '#316b9c', foreground: '#fff' },
  { test: /ffmpeg/, letter: 'F', background: '#25862a', foreground: '#fff' },
]

function BrandSvg({ size, children }: { size: number; children: ReactNode }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className="pointer-events-none block shrink-0">{children}</svg>
}

function GmailIcon({ size }: { size: number }) {
  return <BrandSvg size={size}>
    <path d="M6 37V13L24 26.5L42 13V37" stroke="#E94235" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M6 37V13" stroke="#4285F4" strokeWidth="7" strokeLinecap="round" />
    <path d="M42 37V13" stroke="#34A853" strokeWidth="7" strokeLinecap="round" />
    <path d="M28 23.5L42 13" stroke="#FBBC04" strokeWidth="7" strokeLinecap="round" />
    <path d="M6 13L24 26.5" stroke="#EA4335" strokeWidth="7" strokeLinecap="round" />
  </BrandSvg>
}

function ExcelIcon({ size }: { size: number }) {
  return <BrandSvg size={size}>
    <path d="M20 7H42V41H20Z" fill="#21A366" />
    <path d="M26 12H37V36H26Z" fill="#107C41" />
    <path d="M26 20H37M26 28H37M31.5 12V36" stroke="#B9E4C5" strokeWidth="1.5" />
    <path d="M5 12L28 8V40L5 36Z" fill="#107C41" />
    <path d="M11 20L16 26L11 32M22 19L16 26L22 33" stroke="white" strokeWidth="3.4" strokeLinecap="square" />
  </BrandSvg>
}

function SheetsIcon({ size }: { size: number }) {
  return <BrandSvg size={size}>
    <path d="M10 4H30L40 14V42C40 43.1 39.1 44 38 44H10C8.9 44 8 43.1 8 42V6C8 4.9 8.9 4 10 4Z" fill="#188038" />
    <path d="M30 4V14H40Z" fill="#81C995" />
    <rect x="14" y="19" width="20" height="18" rx="1.2" stroke="white" strokeWidth="2" />
    <path d="M14 25H34M14 31H34M21 19V37M27.5 19V37" stroke="white" strokeWidth="1.8" />
  </BrandSvg>
}

function DriveIcon({ size }: { size: number }) {
  return <BrandSvg size={size}>
    <path d="M16 7H27L44 35H33Z" fill="#FFBA00" />
    <path d="M16 7H27L12 35H1Z" fill="#00875A" />
    <path d="M12 35H44L38.5 44H6.5Z" fill="#4285F4" />
  </BrandSvg>
}

function OpenAIIcon({ size }: { size: number }) {
  return <BrandSvg size={size}>
    <circle cx="24" cy="24" r="21" fill="#111" />
    <g fill="none" stroke="white" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M24 12.2a7.2 7.2 0 0 1 12.5 4.9v8.1l-12.5 7.2-7-4.1V17.1Z" />
      <path d="M34.9 18.1a7.2 7.2 0 0 1 0 14.4l-7 4-7-4-7-12.1 7-4.1 7 4.1v14.2" />
      <path d="M13.1 29.9a7.2 7.2 0 0 1 0-14.4l7-4 7 4 7 12.1-7 4.1-7-4.1V13.4" />
    </g>
  </BrandSvg>
}

function GeminiIcon({ size }: { size: number }) {
  return <BrandSvg size={size}>
    <defs><linearGradient id="gemini-gradient" x1="7" y1="41" x2="41" y2="7"><stop stopColor="#4E82EE" /><stop offset=".48" stopColor="#8868D8" /><stop offset="1" stopColor="#D96570" /></linearGradient></defs>
    <path d="M24 4C25.9 16.4 31.6 22.1 44 24 31.6 25.9 25.9 31.6 24 44 22.1 31.6 16.4 25.9 4 24 16.4 22.1 22.1 16.4 24 4Z" fill="url(#gemini-gradient)" />
  </BrandSvg>
}

function TelegramIcon({ size }: { size: number }) {
  return <BrandSvg size={size}>
    <circle cx="24" cy="24" r="22" fill="#27A7E7" />
    <path d="M11 23.4 35.7 13.9c1.1-.4 2.1.3 1.7 2.1l-4.2 19.7c-.3 1.4-1.1 1.7-2.3 1.1l-6.4-4.7-3.1 3c-.3.3-.6.6-1.3.6l.5-6.5 11.8-10.7c.5-.5-.1-.7-.8-.3L17 27.4l-6.3-2c-1.4-.4-1.4-1.4.3-2Z" fill="white" />
  </BrandSvg>
}

function YouTubeIcon({ size }: { size: number }) {
  return <BrandSvg size={size}>
    <rect x="3" y="10" width="42" height="28" rx="9" fill="#FF0033" />
    <path d="m20 17 13 7-13 7Z" fill="white" />
  </BrandSvg>
}

function PythonIcon({ size }: { size: number }) {
  return <BrandSvg size={size}>
    <path d="M23.7 4C14 4 14.6 8.2 14.6 8.2v4.4h9.3V14H11S5 13.3 5 22.8s5.2 9.1 5.2 9.1h3.1v-4.4s-.2-5.2 5.1-5.2h8.9s5 .1 5-4.8V9s.8-5-8.6-5Z" fill="#3776AB" />
    <circle cx="19" cy="9" r="1.7" fill="white" />
    <path d="M24.3 44c9.7 0 9.1-4.2 9.1-4.2v-4.4h-9.3V34H37s6 .7 6-8.8-5.2-9.1-5.2-9.1h-3.1v4.4s.2 5.2-5.1 5.2h-8.9s-5-.1-5 4.8V39s-.8 5 8.6 5Z" fill="#FFD43B" />
    <circle cx="29" cy="39" r="1.7" fill="white" />
  </BrandSvg>
}

function FfmpegIcon({ size }: { size: number }) {
  return <BrandSvg size={size}>
    <path d="M6 14 16 7l25 27-10 7Z" fill="#0B8F36" />
    <path d="m4 24 8-6 18 20-8 6Zm14-13 8-6 18 20-8 6Z" fill="#55C34A" />
    <path d="m13 20 5-4 17 18-5 4Z" fill="white" opacity=".9" />
  </BrandSvg>
}

function BrandBadge({ brand, size }: { brand: Brand; size: number }) {
  return <span aria-hidden="true" className="pointer-events-none grid shrink-0 place-items-center rounded-[6px] font-bold leading-none"
    style={{ width: size, height: size, background: brand.background, color: brand.foreground, fontSize: Math.min(size * 0.53, 26) }}>
    {brand.letter}
  </span>
}

export function WorkflowToolIcon({ type, label = '', size = 32 }: WorkflowToolIconProps) {
  const text = `${type} ${label}`.toLowerCase()
  if (/gmail/.test(text)) return <GmailIcon size={size} />
  if (/google[ ._-]?sheets|\bsheets\b/.test(text)) return <SheetsIcon size={size} />
  if (/\bexcel\b/.test(text)) return <ExcelIcon size={size} />
  if (/google[ ._-]?drive/.test(text)) return <DriveIcon size={size} />
  if (/openai|chatgpt/.test(text)) return <OpenAIIcon size={size} />
  if (/gemini/.test(text)) return <GeminiIcon size={size} />
  if (/telegram/.test(text)) return <TelegramIcon size={size} />
  if (/youtube/.test(text)) return <YouTubeIcon size={size} />
  if (/python/.test(text)) return <PythonIcon size={size} />
  if (/ffmpeg/.test(text)) return <FfmpegIcon size={size} />

  const brand = OTHER_BRANDS.find(item => item.test.test(text))
  if (brand) return <BrandBadge brand={brand} size={size} />

  let icon: ReactNode
  let color = '#858585'

  if (/\bif\b|^flow[.]if|switch|condition|branch/.test(text)) {
    icon = <Split size={size} strokeWidth={1.9} />
    color = '#00887f'
  } else if (/manual[._-]?trigger|execute[._ -]?workflow|when.click|^trigger[.]manual/.test(text)) {
    icon = <MousePointerClick size={size} strokeWidth={1.9} />
    color = '#343434'
  } else if (/trigger|webhook|schedule|cron/.test(text)) {
    icon = /schedule|cron/.test(text) ? <CalendarClock size={size} strokeWidth={1.9} /> : <Zap size={size} strokeWidth={1.9} />
    color = '#dc9b24'
  } else if (/(render|export|encode|mux)/.test(text) && /(cut|trim|clip)/.test(text)) {
    icon = <span className="relative grid place-items-center" style={{ width: size, height: size }}>
      <Clapperboard size={size * 0.88} strokeWidth={1.85} />
      <Scissors size={size * 0.42} strokeWidth={2.3} className="absolute bottom-0 right-0 rounded-full bg-white" />
    </span>
    color = '#d25464'
  } else if (/render|export|encode|mux/.test(text)) {
    icon = <Clapperboard size={size} strokeWidth={1.85} />
    color = '#cf5a66'
  } else if (/cut|trim|split.clip|edit.clip/.test(text)) {
    icon = <Scissors size={size} strokeWidth={1.9} />
    color = '#d05b66'
  } else if (/summary|summarize|highlight|script|prompt/.test(text)) {
    icon = <Sparkles size={size} strokeWidth={1.8} />
    color = '#e60079'
  } else if (/transcri|speech|audio|voice/.test(text)) {
    icon = <AudioLines size={size} strokeWidth={1.8} />
    color = '#438be7'
  } else if (/subtitle|caption/.test(text)) {
    icon = <Subtitles size={size} strokeWidth={1.8} />
    color = '#c58e35'
  } else if (/music|sound/.test(text)) {
    icon = <Music2 size={size} strokeWidth={1.8} />
    color = '#438be7'
  } else if (/video|media|movie|frame|thumbnail/.test(text)) {
    icon = <Film size={size} strokeWidth={1.8} />
    color = '#d76069'
  } else if (/\bai\b|^ai[.]|agent|\bllm\b|model/.test(text)) {
    icon = <Bot size={size} strokeWidth={1.8} />
    color = '#e60079'
  } else if (/json|csv/.test(text)) {
    icon = <FileJson2 size={size} strokeWidth={1.8} />
  } else if (/filter|limit/.test(text)) {
    icon = <ListFilter size={size} strokeWidth={1.8} />
  } else if (/http|url|network/.test(text)) {
    icon = <Globe2 size={size} strokeWidth={1.8} />
  } else if (/code|javascript/.test(text)) {
    icon = <Code2 size={size} strokeWidth={1.8} />
  } else if (/mysql|database|sql/.test(text)) {
    icon = <Database size={size} strokeWidth={1.8} />
  } else if (/spreadsheet|table/.test(text)) {
    icon = <FileSpreadsheet size={size} strokeWidth={1.8} />
  } else if (/mail/.test(text)) {
    icon = <Mail size={size} strokeWidth={1.8} />
  } else if (/approval|review/.test(text)) {
    icon = <CheckCheck size={size} strokeWidth={1.8} />
  } else if (/workflow|flow|loop|merge/.test(text)) {
    icon = <Workflow size={size} strokeWidth={1.8} />
  } else if (/merge|route/.test(text)) {
    icon = <GitBranch size={size} strokeWidth={1.8} />
  } else {
    icon = <Video size={size} strokeWidth={1.8} />
  }

  return <span aria-hidden="true" className="pointer-events-none inline-grid shrink-0 place-items-center"
    style={{ width: size, height: size, color }}>
    {icon}
  </span>
}

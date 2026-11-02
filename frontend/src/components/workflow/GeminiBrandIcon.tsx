import { useId } from 'react'

type Props = {
  size?: number
  className?: string
}

/** Local, network-free multicolor Gemini-style mark.
 * Uses useId() so gradients remain unique on canvases with multiple nodes.
 */
export function GeminiBrandIcon({ size = 28, className = '' }: Props) {
  const gradientId = useId().replace(/:/g, '')

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      role="img"
      aria-label="Google Gemini"
      className={`pointer-events-none shrink-0 ${className}`}
    >
      <defs>
        <linearGradient id={gradientId} x1="8" y1="7" x2="57" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2386F7" />
          <stop offset="0.32" stopColor="#5D75ED" />
          <stop offset="0.64" stopColor="#A75DD6" />
          <stop offset="1" stopColor="#E65AA6" />
        </linearGradient>
      </defs>
      <path
        d="M32 2.7C34.2 17.6 43.2 27.1 61.3 32C43.2 36.9 34.2 46.4 32 61.3C29.8 46.4 20.8 36.9 2.7 32C20.8 27.1 29.8 17.6 32 2.7Z"
        fill={`url(#${gradientId})`}
      />
    </svg>
  )
}

export default GeminiBrandIcon

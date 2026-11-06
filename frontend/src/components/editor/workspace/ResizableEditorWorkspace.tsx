
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'

type ResizableEditorWorkspaceProps = {
  library: ReactNode
  preview: ReactNode
  inspector: ReactNode
  timeline: ReactNode
  className?: string
  storageKey?: string
}

type Sizes = {
  left: number
  right: number
  bottom: number
}

type Handle = 'left' | 'right' | 'bottom'

type DragState = {
  handle: Handle
  startX: number
  startY: number
  sizes: Sizes
}

const HANDLE = 9

const DEFAULTS: Sizes = {
  left: 290,
  right: 335,
  bottom: 285,
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

function fitSizes(
  sizes: Sizes,
  width: number,
  height: number,
): Sizes {
  const availableWidth = Math.max(0, width - HANDLE * 2)
  const availableHeight = Math.max(0, height - HANDLE)

  const minPreview = Math.min(320, availableWidth * 0.48)
  const rest = Math.max(0, availableWidth - minPreview)

  const minLeft = Math.min(210, rest * 0.42)
  const minRight = Math.min(240, rest - minLeft)

  const left = clamp(
    sizes.left,
    minLeft,
    Math.max(minLeft, rest - minRight),
  )

  const right = clamp(
    sizes.right,
    minRight,
    Math.max(minRight, rest - left),
  )

  const minPreviewHeight = Math.min(
    215,
    availableHeight * 0.55,
  )

  const minTimelineHeight = Math.min(
    150,
    availableHeight - minPreviewHeight,
  )

  const bottom = clamp(
    sizes.bottom,
    minTimelineHeight,
    Math.max(
      minTimelineHeight,
      availableHeight - minPreviewHeight,
    ),
  )

  return { left, right, bottom }
}

export function ResizableEditorWorkspace({
  library,
  preview,
  inspector,
  timeline,
  className = '',
  storageKey = 'cliptora.editor.workspace.sizes.v1',
}: ResizableEditorWorkspaceProps) {
  const root = useRef<HTMLDivElement>(null)
  const drag = useRef<DragState | null>(null)

  const [bounds, setBounds] = useState({
    width: 1280,
    height: 800,
  })

  const [sizes, setSizes] = useState<Sizes>(DEFAULTS)
  const [hydrated, setHydrated] = useState(false)
  const [moving, setMoving] = useState<Handle | null>(null)

  useEffect(() => {
    setHydrated(false)

    try {
      const saved = window.localStorage.getItem(storageKey)

      if (saved) {
        const parsed: unknown = JSON.parse(saved)

        if (parsed && typeof parsed === 'object') {
          const item = parsed as Record<string, unknown>

          const valid = (
            ['left', 'right', 'bottom'] as const
          ).every(
            key =>
              typeof item[key] === 'number' &&
              Number.isFinite(item[key]),
          )

          if (valid) {
            setSizes({
              left: item.left as number,
              right: item.right as number,
              bottom: item.bottom as number,
            })
          } else {
            setSizes(DEFAULTS)
          }
        } else {
          setSizes(DEFAULTS)
        }
      } else {
        setSizes(DEFAULTS)
      }
    } catch {
      setSizes(DEFAULTS)
    }

    setHydrated(true)
  }, [storageKey])

  useEffect(() => {
    if (!hydrated) return

    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify(sizes),
      )
    } catch {
      // Local storage is optional.
    }
  }, [hydrated, sizes, storageKey])

  useEffect(() => {
    const node = root.current
    if (!node) return

    const update = () => {
      setBounds({
        width: node.clientWidth,
        height: node.clientHeight,
      })
    }

    update()

    const observer = new ResizeObserver(update)
    observer.observe(node)

    return () => observer.disconnect()
  }, [])

  const fitted = fitSizes(
    sizes,
    bounds.width,
    bounds.height,
  )

  function change(handle: Handle, target: number) {
    setSizes(previous => {
      const current = fitSizes(
        previous,
        bounds.width,
        bounds.height,
      )

      const availableWidth = Math.max(
        0,
        bounds.width - HANDLE * 2,
      )

      const minPreview = Math.min(
        320,
        availableWidth * 0.48,
      )

      const rest = Math.max(
        0,
        availableWidth - minPreview,
      )

      const minLeft = Math.min(210, rest * 0.42)
      const minRight = Math.min(240, rest - minLeft)

      const availableHeight = Math.max(
        0,
        bounds.height - HANDLE,
      )

      const minTop = Math.min(
        215,
        availableHeight * 0.55,
      )

      const minBottom = Math.min(
        150,
        availableHeight - minTop,
      )

      if (handle === 'left') {
        return {
          ...current,
          left: clamp(
            target,
            minLeft,
            Math.max(minLeft, rest - current.right),
          ),
        }
      }

      if (handle === 'right') {
        return {
          ...current,
          right: clamp(
            target,
            minRight,
            Math.max(minRight, rest - current.left),
          ),
        }
      }

      return {
        ...current,
        bottom: clamp(
          target,
          minBottom,
          Math.max(minBottom, availableHeight - minTop),
        ),
      }
    })
  }

  function start(
    handle: Handle,
    event: PointerEvent<HTMLDivElement>,
  ) {
    if (event.button !== 0) return

    event.preventDefault()

    drag.current = {
      handle,
      startX: event.clientX,
      startY: event.clientY,
      sizes: fitted,
    }

    setMoving(handle)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current
    if (!current) return

    const dx = event.clientX - current.startX
    const dy = event.clientY - current.startY

    if (current.handle === 'left') {
      change('left', current.sizes.left + dx)
    }

    if (current.handle === 'right') {
      change('right', current.sizes.right - dx)
    }

    if (current.handle === 'bottom') {
      change('bottom', current.sizes.bottom - dy)
    }
  }

  function end(event: PointerEvent<HTMLDivElement>) {
    drag.current = null
    setMoving(null)

    if (
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function keys(
    handle: Handle,
    event: KeyboardEvent<HTMLDivElement>,
  ) {
    const step = event.shiftKey ? 40 : 12

    if (
      handle === 'left' &&
      (event.key === 'ArrowRight' ||
        event.key === 'ArrowLeft')
    ) {
      event.preventDefault()

      change(
        handle,
        fitted.left +
          (event.key === 'ArrowRight' ? step : -step),
      )

      return
    }

    if (
      handle === 'right' &&
      (event.key === 'ArrowRight' ||
        event.key === 'ArrowLeft')
    ) {
      event.preventDefault()

      change(
        handle,
        fitted.right +
          (event.key === 'ArrowLeft' ? step : -step),
      )

      return
    }

    if (
      handle === 'bottom' &&
      (event.key === 'ArrowUp' ||
        event.key === 'ArrowDown')
    ) {
      event.preventDefault()

      change(
        handle,
        fitted.bottom +
          (event.key === 'ArrowUp' ? step : -step),
      )
    }
  }

  function separator(handle: Handle, name: string) {
    const vertical = handle !== 'bottom'

    const value =
      handle === 'left'
        ? fitted.left
        : handle === 'right'
          ? fitted.right
          : fitted.bottom

    return (
      <div
        key={handle}
        role="separator"
        tabIndex={0}
        aria-orientation={
          vertical ? 'vertical' : 'horizontal'
        }
        aria-label={name}
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={
          vertical
            ? Math.round(bounds.width)
            : Math.round(bounds.height)
        }
        title={`${name} — drag to resize · double-click to reset`}
        onPointerDown={event => start(handle, event)}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={() => {
          drag.current = null
          setMoving(null)
        }}
        onKeyDown={event => keys(handle, event)}
        onDoubleClick={() =>
          change(handle, DEFAULTS[handle])
        }
        className={[
          'group relative z-25',
          'flex items-center justify-center',
          'min-h-0 min-w-0',
          'touch-none select-none',
          'outline-none transition-colors duration-150',

          // Light mode
          'bg-[#f0f1f3]',
          'hover:bg-[#e8e4f2]',

          // Dark mode
          'dark:bg-[#202328]',
          'dark:hover:bg-[#2c2736]',

          // Keyboard focus
          'focus-visible:bg-violet-50',
          'focus-visible:ring-2',
          'focus-visible:ring-inset',
          'focus-visible:ring-violet-500',

          'dark:focus-visible:bg-[#342b49]',
          'dark:focus-visible:ring-violet-400',

          // Active resize
          moving === handle
            ? 'bg-violet-100 dark:bg-[#352747]'
            : '',

          // Direction
          vertical
            ? 'h-full w-full cursor-col-resize'
            : 'h-full w-full cursor-row-resize',
        ].join(' ')}
      >
        <div
          aria-hidden="true"
          className={[
            'rounded-full transition-colors duration-150',

            // Handle colors
            'bg-[#bcc2cb]',
            'dark:bg-[#656b76]',

            // Hover
            'group-hover:bg-violet-500',
            'dark:group-hover:bg-violet-400',

            // Focus
            'group-focus-visible:bg-violet-500',
            'dark:group-focus-visible:bg-violet-400',

            // Active
            moving === handle
              ? 'bg-violet-600 dark:bg-violet-400'
              : '',

            // Orientation
            vertical
              ? 'h-12 w-[3px]'
              : 'h-[3px] w-12',
          ].join(' ')}
        />
      </div>
    )
  }

  return (
    <div
      ref={root}
      className={[
        'relative grid h-full min-h-0',
        'w-full min-w-0 overflow-hidden',

        // Light background
        'bg-[#f7f8fa]',

        // Dark background
        'dark:bg-[#101214]',

        className,
      ].join(' ')}
      style={{
        gridTemplateRows:
          `minmax(0, 1fr) ${HANDLE}px ${fitted.bottom}px`,
      }}
    >
      <div
        className="grid min-h-0 min-w-0"
        style={{
          gridTemplateColumns:
            `${fitted.left}px ${HANDLE}px minmax(0, 1fr) ${HANDLE}px ${fitted.right}px`,
        }}
      >
        <div
          className={[
            'flex h-full min-h-0 min-w-0 overflow-hidden',
            'bg-white dark:bg-[#191b1d]',
          ].join(' ')}
        >
          {library}
        </div>

        {separator(
          'left',
          'Resize Library and Preview',
        )}

        <div
          className={[
            'h-full min-h-0 min-w-0 overflow-hidden',
            'bg-white dark:bg-[#191b1d]',
          ].join(' ')}
        >
          {preview}
        </div>

        {separator(
          'right',
          'Resize Preview and Clip Settings',
        )}

        <div
          className={[
            'h-full min-h-0 min-w-0 overflow-hidden',
            'bg-white dark:bg-[#191b1d]',
          ].join(' ')}
        >
          {inspector}
        </div>
      </div>

      {separator(
        'bottom',
        'Resize Preview and Timeline',
      )}

      <div
        className={[
          'h-full min-h-0 min-w-0 overflow-hidden',
          'bg-white dark:bg-[#191b1d]',
        ].join(' ')}
      >
        {timeline}
      </div>
    </div>
  )
}

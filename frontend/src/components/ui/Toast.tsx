import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, CheckCircle2, CircleAlert, Info, X } from 'lucide-react'

export type ToastVariant = 'success' | 'info' | 'warning' | 'error'

type ToastProps = {
  message: string
  variant?: ToastVariant
  title?: string
  duration?: number
  onDismiss: () => void
}

const styles: Record<ToastVariant, { icon: ReactNode; title: string; border: string; iconClass: string; progress: string }> = {
  success: { icon: <CheckCircle2 size={19} />, title: 'Saved', border: 'border-emerald-200', iconClass: 'text-emerald-600', progress: 'bg-emerald-500' },
  info: { icon: <Info size={19} />, title: 'Workflow update', border: 'border-blue-200', iconClass: 'text-blue-600', progress: 'bg-blue-500' },
  warning: { icon: <AlertTriangle size={19} />, title: 'Check this', border: 'border-amber-200', iconClass: 'text-amber-600', progress: 'bg-amber-500' },
  error: { icon: <CircleAlert size={19} />, title: 'Something went wrong', border: 'border-red-200', iconClass: 'text-red-600', progress: 'bg-red-500' },
}

export function Toast({ message, variant = 'info', title, duration = 4500, onDismiss }: ToastProps) {
  const appearance = styles[variant]
  const dismissRef = useRef(onDismiss)
  useEffect(() => { dismissRef.current = onDismiss }, [onDismiss])

  useEffect(() => {
    if (duration <= 0) return
    const timer = window.setTimeout(() => dismissRef.current(), duration)
    return () => window.clearTimeout(timer)
  }, [duration, message])

  return <div
    role={variant === 'error' ? 'alert' : 'status'}
    aria-live={variant === 'error' ? 'assertive' : 'polite'}
    className={`cliptora-toast pointer-events-auto relative w-[min(390px,calc(100vw-24px))] overflow-hidden rounded-xl border ${appearance.border} bg-white text-[#242424] shadow-[0_16px_50px_#11182724]`}
  >
    <div className="flex items-start gap-3 px-4 py-3.5">
      <span className={`mt-0.5 shrink-0 ${appearance.iconClass}`} aria-hidden="true">{appearance.icon}</span>
      <div className="min-w-0 flex-1">
        <strong className="block text-[13px] font-semibold leading-5">{title ?? appearance.title}</strong>
        <p className="mt-0.5 break-words text-[12px] leading-5 text-[#5f636b]">{message}</p>
      </div>
      <button type="button" onClick={onDismiss} aria-label="Dismiss notification" title="Dismiss" className="grid size-7 shrink-0 place-items-center rounded-md text-[#777] hover:bg-[#f3f4f6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500"><X size={15} /></button>
    </div>
    {duration > 0 && <span aria-hidden="true" className={`cliptora-toast-progress absolute inset-x-0 bottom-0 h-[3px] origin-left ${appearance.progress}`} style={{ animationDuration: `${duration}ms` }} />}
  </div>
}

type ToastViewportProps = {
  children: ReactNode
}

export function ToastViewport({ children }: ToastViewportProps) {
  if (typeof document === 'undefined') return null
  return createPortal(<div className="pointer-events-none fixed right-3 top-[78px] z-[11000] flex max-h-[calc(100dvh-90px)] flex-col items-end gap-2 overflow-hidden sm:right-5">{children}</div>, document.body)
}


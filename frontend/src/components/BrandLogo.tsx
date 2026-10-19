export function Logo({ compact = false }: { compact?: boolean }) {
  return <div className={`brand ${compact ? 'brand-compact' : ''}`}><img src="/assets/cliptora-logo.png" alt="Cliptora" /><div><b>Cliptora</b>{!compact && <span>AI Video Editor</span>}</div></div>
}

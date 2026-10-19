import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Aperture } from 'lucide-react'
import { Logo } from '../components/BrandLogo'

function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return <main className="auth-page">
    <Link to="/" className="auth-brand"><Logo /></Link>
    <section className="auth-card">
      <div className="auth-accent"><Aperture size={20} /></div>
      <header><p>CLIPTORA WORKSPACE</p><h1>{title}</h1><span>{subtitle}</span></header>
      {children}
    </section>
    <p className="auth-footnote">Private projects · Secure sessions · Non-destructive editing</p>
  </main>
}

export { AuthShell }

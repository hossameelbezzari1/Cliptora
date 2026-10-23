import type { Tab } from '../sidebar/ToolRail'
import { ComponentsTab } from './ComponentsTab'
import { VariablesTab } from './VariablesTab'
import { EffectsTab } from './EffectsTab'
import { AnimationsTab } from './AnimationsTab'
import { buttonClass, useSmartLibrary } from './useSmartLibrary'

/** SmartLibrary is a tab router. Each screen lives in its own TSX file. */
export function SmartLibrary({ active }: { active: Tab }) {
  const library = useSmartLibrary()
  const title = active === 'components' ? 'Components'
    : active === 'variables' ? 'Variables'
    : active === 'effects' ? 'Effects'
    : active === 'animations' ? 'Animations' : 'Library'

  return <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain p-3 text-xs text-white">
    <header className="mb-3 flex shrink-0 items-center justify-between gap-2">
      <strong className="text-sm">{title}</strong>
      <button type="button" className={buttonClass} onClick={() => void library.refresh()}>Refresh</button>
    </header>
    {library.error && <p role="alert" className="mb-3 rounded bg-red-900/30 p-2 text-red-300">{library.error}</p>}
    {active === 'components' && <ComponentsTab library={library}/>}
    {active === 'variables' && <VariablesTab library={library}/>}
    {active === 'effects' && <EffectsTab library={library}/>}
    {active === 'animations' && <AnimationsTab library={library}/>}
  </section>
}

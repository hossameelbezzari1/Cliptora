import { animations, effects } from '../../../lib/catalog'
import { SavedLibraryItems } from './SavedLibraryItems'
import { buttonClass, fieldClass, type SmartLibraryModel } from './useSmartLibrary'

type PresetTab = 'effects' | 'animations'

export function PresetCatalogTab({ library, tab }: { library: SmartLibraryModel; tab: PresetTab }) {
  const { search, setSearch, name, setName, selected, busy, save } = library
  const isEffect = tab === 'effects'
  const presets = isEffect ? effects : animations
  return <>
    <p className="mb-2 text-[#9ea5ae]">{isEffect ? '50 effect definitions' : '30 animation definitions'} · Save your presets globally. Advanced rendering depends on the export engine.</p>
    <input className={`${fieldClass} w-full`} placeholder="Search library" value={search}
      onChange={event => setSearch(event.target.value)}/>
    <div className="mt-2 max-h-56 overflow-y-auto rounded border border-[#31363c]">
      {presets.filter(entry => entry.name.toLowerCase().includes(search.toLowerCase())).map(entry =>
        <div key={`${entry.group}/${entry.name}`} className="flex items-center justify-between gap-1 border-b border-[#31363c] p-2">
          <div className="min-w-0"><strong className="break-words">{entry.name}</strong>
            <div className="text-[10px] text-[#9ea5ae]">{entry.group} · {entry.engine}</div></div>
          <button type="button" className={`${buttonClass} shrink-0`} disabled={busy}
            onClick={() => void save(entry.kind, entry.name, {
              ...entry,
              parameters: Object.fromEntries(entry.parameters.map(parameter => [
                parameter, parameter === 'duration' ? 1 : parameter === 'enabled' ? true : 0.5,
              ])),
            }, null)}>Save preset</button>
        </div>)}
    </div>
    <p className="my-2 text-[#a0a6b0]">Create compound custom preset: save selected clip's configured stack.</p>
    <div className="flex gap-1">
      <input className={`${fieldClass} min-w-0 flex-1`} placeholder="My custom preset" value={name}
        onChange={event => setName(event.target.value)}/>
      <button type="button" className={buttonClass} disabled={!selected || !name.trim() || busy}
        onClick={() => void save(isEffect ? 'effect' : 'animation', name, {
          name, stack: isEffect ? selected?.props?.effect_stack ?? [] : selected?.props?.animation_stack ?? [],
        }, null)}>Save</button>
    </div>
    <SavedLibraryItems library={library} kind={isEffect ? 'effect' : 'animation'}/>
  </>
}

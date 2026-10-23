import { buttonClass, type LibraryItemKind, type SmartLibraryModel } from './useSmartLibrary'

export function SavedLibraryItems({ library, kind, canApply = true }: {
  library: SmartLibraryModel
  kind: LibraryItemKind
  canApply?: boolean
}) {
  const items = library.visible.filter(item => item.kind === kind)
  return <div className="mt-3 border-t border-[#30343b] pt-2">
    <strong>Saved library</strong>
    {items.map(item => <div className="mt-2 flex items-center gap-2 rounded bg-[#24272e] p-2" key={item.id}>
      <span className="min-w-0 flex-1 truncate" title={item.name}>{item.name}</span>
      {canApply && <button type="button" className={buttonClass} onClick={() => library.apply(item)}>Apply</button>}
      <button type="button" className={buttonClass} onClick={() => void library.remove(item)} title={`Delete ${item.name}`}>×</button>
    </div>)}
  </div>
}

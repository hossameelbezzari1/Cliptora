"""CLIPTORA: install an adaptive right-side vertical tab rail around the EXISTING Inspector.

Safe by default: dry-run, never mutates backend, DB, Git, assets or any Inspector settings.
Runs only if the exact named InspectorPanel export is recognized.
"""
from __future__ import annotations
import argparse
import re
from pathlib import Path

NAME='AdaptiveInspectorPanel.tsx'
ANCHOR="import { AdaptiveInspectorPanel } from './AdaptiveInspectorPanel'"
ORIGINAL='CliptoraOriginalInspectorPanel'
MARK='// CLIPTORA adaptive inspector — original Inspector kept in All settings.'


def plan(root:Path, source:Path)->dict[Path,str]:
    inspector=root/'frontend/src/components/editor/inspector/InspectorPanel.tsx'
    new=root/'frontend/src/components/editor/inspector'/NAME
    if not inspector.is_file(): raise ValueError(f'Cannot find {inspector}; no files changed')
    if not source.is_file(): raise ValueError(f'Missing {source}; no files changed')
    before=inspector.read_text(encoding='utf-8')
    src=source.read_text(encoding='utf-8')
    if MARK in before:
        if ANCHOR not in before: raise ValueError('Partial installation detected: no changes made')
        if new.is_file() and new.read_text(encoding='utf-8')!=src:
            raise ValueError('AdaptiveInspectorPanel.tsx differs; will not overwrite edited file')
        return {inspector:before,new:src}
    if ANCHOR in before or ORIGINAL in before:
        raise ValueError('Inspector contains adaptive tabs modifications not made by this installer; no changes made')
    pattern=re.compile(r'\bexport\s+function\s+InspectorPanel\s*\(')
    matches=list(pattern.finditer(before))
    if len(matches)!=1:
        raise ValueError('Expected exactly one "export function InspectorPanel(...)". No changes; share InspectorPanel.tsx for exact integration.')
    after=pattern.sub('function '+ORIGINAL+'(',before,count=1)
    after=ANCHOR+'\n'+after.rstrip()+f'''

{MARK}
export function InspectorPanel() {{
  return <AdaptiveInspectorPanel original={{<{ORIGINAL}/>}} />
}}
'''
    if new.is_file() and new.read_text(encoding='utf-8')!=src:
        raise ValueError('Target AdaptiveInspectorPanel.tsx exists with different contents; no files changed')
    return {inspector:after,new:src}


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--project-root',default=r'C:\xampp\htdocs\CLIPTORA')
    p.add_argument('--source-folder',default=str(Path(__file__).resolve().parent))
    action=p.add_mutually_exclusive_group(required=True)
    action.add_argument('--dry-run',action='store_true')
    action.add_argument('--apply',action='store_true')
    args=p.parse_args()
    root=Path(args.project_root)
    changed=plan(root,Path(args.source_folder)/NAME)
    print('CLIPTORA Adaptive Inspector — Non-destructive installation')
    for path,body in changed.items():
        print(('NO CHANGE' if path.is_file() and path.read_text(encoding='utf-8')==body else 'UPDATE' if path.exists() else 'CREATE').ljust(11),str(path.relative_to(root)))
    if args.dry_run:
        print('DRY RUN: no files changed.');return
    for path,body in changed.items():
        path.parent.mkdir(parents=True,exist_ok=True)
        if not path.exists() or path.read_text(encoding='utf-8')!=body: path.write_text(body,encoding='utf-8')
    print('Installed. Existing inspector accessible from the All settings tab.')
    print('Next: cd frontend; npm run typecheck; npm run build')

if __name__=='__main__':main()

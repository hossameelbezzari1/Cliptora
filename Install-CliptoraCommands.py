r"""Install CLIPTORA Commands into the user's existing FastAPI/React project.

No .git, uploads, database rows or environment credentials are modified.
Run `py Install-CliptoraCommands.py --project-root C:\xampp\htdocs\CLIPTORA --dry-run`
then the same command with `--apply`.

Keep this installer and the three directly downloaded source files in the same folder.
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

FILES = {
    'commands.py': Path('backend/app/api/v1/commands.py'),
    'command_engine.py': Path('backend/app/services/command_engine.py'),
    'ClipCommandsSection.tsx': Path('frontend/src/components/editor/inspector/ClipCommandsSection.tsx'),
    'commands.env.example': Path('backend/commands.env.example'),
}
MARKER = '# CLIPTORA COMMANDS MODULE V3.1'


def plan_install(root: Path, downloads: Path) -> dict[Path, str]:
    main_path = root / 'backend/app/main.py'
    inspector_path = root / 'frontend/src/components/editor/inspector/InspectorPanel.tsx'
    if not main_path.is_file() or not inspector_path.is_file():
        raise RuntimeError('Expected FastAPI app/main.py and React InspectorPanel.tsx were not found. No files changed.')
    required = [downloads / x for x in FILES if x != 'commands.env.example']
    missing = [p.name for p in required if not p.is_file()]
    if missing:
        raise RuntimeError('Download all source files next to this installer: ' + ', '.join(missing))
    main = main_path.read_text(encoding='utf-8')
    inspector = inspector_path.read_text(encoding='utf-8')
    if not re.search(r'\bapp\s*=\s*FastAPI\s*\(', main):
        raise RuntimeError('Unknown FastAPI app pattern. No changes. Send backend/app/main.py for exact integration.')
    if 'from app.api.v1.commands import router as cliptora_commands_router' not in main:
        main = main.rstrip() + f'''\n\n{MARKER}
from app.api.v1.commands import router as cliptora_commands_router
app.include_router(cliptora_commands_router, prefix="/api/v1")
'''
    if 'ClipCommandsSection' not in inspector:
        match = re.search(r'^(?P<indent>[ \t]*)<RepeatSettings\s+clip=\{found\}\s+tracks=\{tracks\}\s*/>', inspector, flags=re.MULTILINE)
        if not match:
            raise RuntimeError('Expected <RepeatSettings clip={found} tracks={tracks}/> not found. No changes; provide InspectorPanel.tsx for a precise patch.')
        insert_at = match.end()
        inspector = inspector[:insert_at] + f"\n{match.group('indent')}<ClipCommandsSection clipId={{found.client_id}}/>" + inspector[insert_at:]
        inspector = "import { ClipCommandsSection } from './ClipCommandsSection'\n" + inspector
    out = {main_path: main, inspector_path: inspector}
    for name, relative in FILES.items():
        source = downloads / name
        if name == 'commands.env.example' and not source.exists():
            continue
        dest = root / relative
        code = source.read_text(encoding='utf-8')
        if dest.is_file() and dest.read_text(encoding='utf-8') != code:
            raise RuntimeError(f'{dest} already contains different code. No files changed; merge manually instead of overwriting.')
        out[dest] = code
    ignore = root / '.gitignore'
    existing_ignore = ignore.read_text(encoding='utf-8') if ignore.is_file() else ''
    if '/backend/commands.env' not in existing_ignore:
        out[ignore] = existing_ignore.rstrip() + '\n/backend/commands.env\n'
    return out


def main():
    parser = argparse.ArgumentParser(description='Safely install CLIPTORA Automation Commands')
    parser.add_argument('--project-root', type=Path, default=Path(r'C:\xampp\htdocs\CLIPTORA'))
    parser.add_argument('--source-folder', type=Path, default=Path(__file__).resolve().parent)
    flag = parser.add_mutually_exclusive_group(required=True)
    flag.add_argument('--dry-run', action='store_true')
    flag.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    root = args.project_root.resolve()
    source = args.source_folder.resolve()
    changes = plan_install(root, source)
    print('CLIPTORA Commands — Git/history/uploads/db remain untouched')
    for path, content in changes.items():
        old = path.read_text(encoding='utf-8') if path.is_file() else None
        print(('NO CHANGE' if old == content else 'CREATE' if old is None else 'UPDATE').ljust(10), path.relative_to(root))
    if args.dry_run:
        print('DRY RUN. No files changed.')
        return
    for path, content in changes.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.is_file() or path.read_text(encoding='utf-8') != content:
            path.write_text(content, encoding='utf-8')
    print('Code installed. Restart backend. The 3 command tables are created when Commands API is first accessed.')
    print('For Selenium: pip install "selenium>=4.20,<5", configure backend/commands.env locally.')
    print('Then: cd frontend; npm run typecheck; npm run build')


if __name__ == '__main__':
    main()

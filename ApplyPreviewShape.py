"""One-file, non-destructive Preview renderer patch for CLIPTORA V3.0.x.

Run from C:\\xampp\\htdocs\\CLIPTORA with:
    py ApplyPreviewShape.py

It does not create backups or touch Git. If the expected branch is absent,
no file is modified and the script prints what to inspect.
"""
from pathlib import Path
import re
import sys

root = Path.cwd()
p = root / 'frontend/src/components/editor/preview/PreviewObject.tsx'
shape = root / 'frontend/src/components/editor/preview/PreviewShape.tsx'
if not p.is_file() or not shape.is_file():
    sys.exit('Missing PreviewObject.tsx or PreviewShape.tsx. Copy both files to their documented destinations first.')
s = p.read_text(encoding='utf-8')
if "import { PreviewShape } from './PreviewShape'" in s:
    print('PreviewObject.tsx already uses PreviewShape. No change.')
    sys.exit(0)
pattern = re.compile(r"(:\s*clip\.type\s*===\s*['\"]text['\"]\s*&&\s*clip\.props\?\.shape_kind\s*\?\s*)<div\b.*?</div>\s*(?=:\s*clip\.type\s*===\s*['\"]text['\"]\s*\?)",re.S)
match = pattern.search(s)
if not match:
    sys.exit('PreviewObject shape rendering differs from V3.0.x. No file changed. Supply PreviewObject.tsx for an exact patch.')
new = s[:match.start()] + match.group(1) + "<PreviewShape shape={clip.props.shape_kind} color={clip.color ?? '#a580db'}/>\n        " + s[match.end():]
new = "import { PreviewShape } from './PreviewShape'\n" + new
p.write_text(new, encoding='utf-8')
print('Patched frontend/src/components/editor/preview/PreviewObject.tsx (SVG shapes + blur renderer).')

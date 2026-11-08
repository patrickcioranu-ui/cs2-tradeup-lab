"""Add a version query to every local script, stylesheet and data URL in the built site.

GitHub Pages caches files for ~10 minutes and we can't set headers, so after a
deploy a browser could mix a new app.js with an old cached module and break.
The Pages workflow runs this on the built site with a per-deploy version, so
every file is fetched fresh after each update. The repo copy stays unstamped.

Usage: python scripts/stamp_assets.py site <version>
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

LOCAL = r"[\w.\-/]+"
PATTERNS = [
    # ES module imports: from "./engine.js"
    (re.compile(rf'(from\s+")(\./{LOCAL}\.js)(")'), r"\1\2?v={v}\3"),
    (re.compile(rf'(import\s+")(\./{LOCAL}\.js)(")'), r"\1\2?v={v}\3"),
    # Workers: new URL("finder.worker.js", import.meta.url)
    (re.compile(rf'(new URL\(")({LOCAL}\.js)(",\s*import\.meta\.url\))'), r"\1\2?v={v}\3"),
    # Data files: `${base}catalog.json`
    (re.compile(r"(\$\{base\}[\w\-]+\.json)(`)"), r"\1?v={v}\2"),
    # HTML: href="styles.css", src="app.js" (relative only)
    (re.compile(rf'((?:href|src)=")((?!https?:|//){LOCAL}\.(?:css|js))(")'), r"\1\2?v={v}\3"),
]


def stamp_text(text: str, version: str) -> str:
    for pattern, replacement in PATTERNS:
        text = pattern.sub(replacement.replace("{v}", version), text)
    return text


def stamp_dir(site: Path, version: str) -> list[Path]:
    """Stamp every .html and .js file directly in ``site``; returns the files changed."""
    changed = []
    for path in sorted(site.iterdir()):
        if path.suffix not in {".html", ".js"} or not path.is_file():
            continue
        original = path.read_text(encoding="utf-8")
        stamped = stamp_text(original, version)
        if stamped != original:
            path.write_text(stamped, encoding="utf-8")
            changed.append(path)
    return changed


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: stamp_assets.py <site dir> <version>")
    for p in stamp_dir(Path(sys.argv[1]), sys.argv[2]):
        print(f"stamped {p.name}")

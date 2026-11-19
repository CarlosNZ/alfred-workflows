"""Builds a workflow's user-facing readme from its docs/ folder.

A workflow's "About this Workflow" text is the `readme` string in its
info.plist. It's written as docs/README.md instead, next to the images it
shows. Alfred loads readme images from paths relative to the workflow
folder, so an image written as `![…](shot.png)` in docs/README.md becomes
`![…](docs/shot.png)` in the readme.

Only inline images are rewritten: `![alt](path)`, `![alt](<path>)` and
`![alt](path "title")`, outside fenced code blocks. URLs, absolute paths
and anchors are left alone (Alfred shows only local images). Reference-style
images (`![alt][ref]`) are not supported.

  docstool.py render <workflow dir>   print the readme
  docstool.py images <workflow dir>   print the images it uses, one per line,
                                      relative to the workflow folder

Both exit 1, naming the problem, when an image is missing or outside the
workflow folder.
"""

import os
import posixpath
import re
import sys
from urllib.parse import unquote

DOCS = "docs"

IMAGE = re.compile(r'!\[(?P<alt>[^\]]*)\]\(\s*(?P<path><[^>]+>|[^)\s]+)(?P<title>\s+"[^"]*")?\s*\)')
FENCE = re.compile(r"^\s{0,3}(```|~~~)")
NOT_LOCAL = re.compile(r"^([a-zA-Z][a-zA-Z0-9+.-]*:|/|#|~)")


class DocsError(Exception):
    pass


def resolve(workflow, path):
    """The workflow-relative path for an image path written in docs/README.md,
    or None when it isn't a local relative path."""
    bracketed = path.startswith("<")
    raw = path[1:-1] if bracketed else path
    if NOT_LOCAL.match(raw):
        return None
    rel = posixpath.normpath(posixpath.join(DOCS, raw))
    if rel.startswith("../"):
        raise DocsError(f"image is outside the workflow folder: {raw}")
    if not os.path.isfile(os.path.join(workflow, unquote(rel))):
        raise DocsError(f"image not found: {DOCS}/README.md refers to {raw}")
    return f"<{rel}>" if bracketed else rel


def process(workflow):
    """Returns (readme text, list of workflow-relative image paths)."""
    with open(os.path.join(workflow, DOCS, "README.md"), encoding="utf-8") as f:
        lines = f.read().splitlines()
    images = []
    fence = None

    def rewrite(m):
        rel = resolve(workflow, m["path"])
        if rel is None:
            return m[0]
        images.append(unquote(rel.strip("<>")))
        return f"![{m['alt']}]({rel}{m['title'] or ''})"

    out = []
    for line in lines:
        f = FENCE.match(line)
        if fence:
            if f and f[1] == fence:
                fence = None
        elif f:
            fence = f[1]
        else:
            line = IMAGE.sub(rewrite, line)
        out.append(line)
    return "\n".join(out).strip() + "\n", list(dict.fromkeys(images))


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in ("render", "images"):
        print(__doc__, file=sys.stderr)
        return 2
    try:
        readme, images = process(sys.argv[2])
    except DocsError as e:
        print(f"docs: {e}", file=sys.stderr)
        return 1
    if sys.argv[1] == "render":
        sys.stdout.write(readme)
    else:
        for path in images:
            print(path)
    return 0


if __name__ == "__main__":
    sys.exit(main())

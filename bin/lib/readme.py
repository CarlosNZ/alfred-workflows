"""Reads a workflow's user-facing readme out of its README.md.

A workflow's README.md is its user guide, shown on GitHub, and the part of it
Alfred shows ("About this Workflow", and the Gallery page) is copied into the
`readme` key of info.plist. That part is everything after the title (a first
line starting "# ") and before the END_MARKER line, with blank lines trimmed
from both ends. The rest stays on GitHub only. A README.md without the marker
isn't a user guide (it may be developer notes) and isn't copied.

  readme.py text <README.md>          print the Alfred part; exit 3 if the
                                      file has no marker
  readme.py json <README.md>          the same, as a JSON string
  readme.py plist                     read info.plist from stdin and print
                                      its readme, trimmed the same way
  readme.py check <name> <README.md>  read info.plist from stdin, exit 1 if
                                      its readme differs from the README's
                                      Alfred part; a file with no marker
                                      passes
"""

import json
import plistlib
import sys

END_MARKER = "<!-- end of Alfred readme -->"
NO_MARKER = 3


def trimmed(text):
    """Without blank lines at either end, or trailing spaces on the last."""
    return text.strip("\n").rstrip()


def alfred_part(readme):
    """The Alfred part of README.md's text, or None without the marker."""
    lines = readme.splitlines()
    try:
        end = [line.strip() for line in lines].index(END_MARKER)
    except ValueError:
        return None
    lines = lines[:end]
    first = next((i for i, line in enumerate(lines) if line.strip()), None)
    if first is not None and lines[first].startswith("# "):
        lines = lines[first + 1:]
    return trimmed("\n".join(lines))


def plist_readme(data):
    return trimmed(plistlib.loads(data).get("readme", ""))


def read_readme(path):
    with open(path, encoding="utf-8") as f:
        return alfred_part(f.read())


def main():
    args = sys.argv[1:]
    mode = args[0] if args else ""
    if mode in ("text", "json") and len(args) == 2:
        text = read_readme(args[1])
        if text is None:
            print(f"{args[1]}: no '{END_MARKER}' line, so it isn't a user guide", file=sys.stderr)
            return NO_MARKER
        print(json.dumps(text, ensure_ascii=False) if mode == "json" else text)
        return 0
    if mode == "plist" and len(args) == 1:
        print(plist_readme(sys.stdin.buffer.read()))
        return 0
    if mode == "check" and len(args) == 3:
        text = read_readme(args[2])
        if text is None:
            return 0
        if plist_readme(sys.stdin.buffer.read()) != text:
            print(f"{args[1]}: info.plist's readme differs from README.md")
            return 1
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())

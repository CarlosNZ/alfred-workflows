"""Reads a workflow's user-facing readme out of its README.md.

A workflow's README.md is its user guide, shown on GitHub, and the part of it
Alfred shows ("About this Workflow", and the Gallery page) is copied into the
`readme` key of info.plist. That part is everything before the END_MARKER
line, and after the START_MARKER line if there is one before it, or else after
the title (a first line starting "# "), with blank lines trimmed from both
ends. The rest stays on GitHub only. A README.md without the end marker isn't
a user guide (it may be developer notes) and isn't copied.

Every workflow's README.md, user guide or not, must link to the workflow's
latest release on GitHub in its GitHub-only part, once it has one. That's the
.alfredworkflow file of the highest version of the workflow's published
releases that aren't pre-releases.

  readme.py text <README.md>          print the Alfred part; exit 3 if the
                                      file has no marker
  readme.py json <README.md>          the same, as a JSON string
  readme.py plist                     read info.plist from stdin and print
                                      its readme, trimmed the same way
  readme.py check <name> <README.md>  read info.plist from stdin, exit 1 if
                                      its readme differs from the README's
                                      Alfred part; a file with no marker
                                      passes
  readme.py download <dir> <README.md> <releases>
                                      exit 1 if README.md doesn't link to
                                      the latest release of the workflow
                                      in <dir>; <releases> holds one JSON
                                      object per line with GitHub's
                                      tag_name, draft and prerelease, and
                                      assets, a list of download URLs
"""

import json
import os
import plistlib
import re
import sys

START_MARKER = "<!-- start of Alfred readme -->"
END_MARKER = "<!-- end of Alfred readme -->"
NO_MARKER = 3


def trimmed(text):
    """Without blank lines at either end, or trailing spaces on the last."""
    return text.strip("\n").rstrip()


def marker_line(lines, marker):
    """Index of the first line that is the marker, or None."""
    return next((i for i, line in enumerate(lines) if line.strip() == marker), None)


def alfred_bounds(lines):
    """(start, end) slice of README.md's lines that is the Alfred part, or
    None without the end marker."""
    end = marker_line(lines, END_MARKER)
    if end is None:
        return None
    start = marker_line(lines[:end], START_MARKER)
    if start is not None:
        return start + 1, end
    first = next((i for i, line in enumerate(lines[:end]) if line.strip()), None)
    if first is not None and lines[first].startswith("# "):
        return first + 1, end
    return 0, end


def alfred_part(readme):
    """The Alfred part of README.md's text, or None without the end marker."""
    lines = readme.splitlines()
    bounds = alfred_bounds(lines)
    if bounds is None:
        return None
    start, end = bounds
    return trimmed("\n".join(lines[start:end]))


def github_part(readme):
    """README.md's text apart from the Alfred part: what only GitHub shows."""
    lines = readme.splitlines()
    start, end = alfred_bounds(lines) or (0, 0)
    return "\n".join(lines[:start] + lines[end:])


def version_key(version):
    """Sort key for a version such as 1.2.3 or 1.2.3-beta.1, where a version
    with a suffix comes before the same one without."""
    m = re.match(r"(\d+(?:\.\d+)*)(.*)", version)
    if not m:
        return (), False
    return tuple(int(n) for n in m[1].split(".")), not m[2]


def latest_release(slug, releases):
    """(version, download URL) of the workflow's latest published release
    that isn't a pre-release and has a .alfredworkflow file, or None."""
    prefix = slug + "/v"
    best = None
    for release in releases:
        tag = release["tag_name"]
        if release["draft"] or release["prerelease"] or not tag.startswith(prefix):
            continue
        url = next((u for u in release["assets"] if u.endswith(".alfredworkflow")), None)
        if url is None:
            continue
        version = tag[len(prefix):]
        if best is None or version_key(version) > version_key(best[0]):
            best = version, url
    return best


def unescape_slashes(text):
    """GitHub serves a tag's slash in a download URL as either / or %2F."""
    return re.sub("%2F", "/", text, flags=re.IGNORECASE)


def check_download(workflow, readme, releases):
    """Error message if README.md's GitHub-only part doesn't link to the
    workflow's latest release, else None."""
    latest = latest_release(os.path.basename(os.path.normpath(workflow)), releases)
    if latest is None:
        return None
    version, url = latest
    if unescape_slashes(url) in unescape_slashes(github_part(readme)):
        return None
    lines = readme.splitlines()
    if marker_line(lines, END_MARKER) is None:
        where = "near the top"
    elif marker_line(lines, START_MARKER) is None:
        where = f"below the title, followed by a '{START_MARKER}' line so Alfred's readme leaves it out"
    else:
        where = f"above the '{START_MARKER}' line"
    return (f"{workflow}/README.md: no download link to v{version}, the latest release on GitHub; "
            f"add it {where}:\n\n    **[Download v{version}]({url})**\n")


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
    if mode == "download" and len(args) == 4:
        with open(args[2], encoding="utf-8") as f:
            readme = f.read()
        with open(args[3], encoding="utf-8") as f:
            releases = [json.loads(line) for line in f if line.strip()]
        error = check_download(args[1], readme, releases)
        if error:
            print(error)
            return 1
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())

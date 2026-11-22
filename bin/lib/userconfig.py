"""Compares workflows' User Configuration items with the shared ones.

Each shared/userconfig/*.json file holds a list of User Configuration items,
as they appear in info.plist's `userconfigurationconfig` (in JSON). A workflow
uses a shared item by having an item with the same `variable`, and its copy
must equal the shared one exactly. Workflows' other items are left alone.

  userconfig.py diff <shared dir>          read info.plist from stdin; for each
                                           item that differs from the shared
                                           one, print its index, variable and
                                           the shared item as JSON, separated
                                           by tabs
  userconfig.py check <shared dir> <name>  read info.plist from stdin, exit 1
                                           if any item differs
"""

import json
import plistlib
import sys
from pathlib import Path


def shared_items(folder):
    items = {}
    for path in sorted(Path(folder).glob("*.json")):
        for item in json.loads(path.read_text(encoding="utf-8")):
            variable = item["variable"]
            if variable in items:
                raise SystemExit(f"{path}: '{variable}' is also defined in {items[variable][0].name}")
            items[variable] = (path, item)
    return {variable: item for variable, (_, item) in items.items()}


def canonical(item):
    # JSON text rather than ==, which would take True for 1 and 16.0 for 16.
    return json.dumps(item, sort_keys=True, ensure_ascii=False)


def differences(plist, shared):
    """(index, variable, shared item) for each of the workflow's items that
    differs from the shared item with its variable."""
    found = []
    for index, item in enumerate(plist.get("userconfigurationconfig", [])):
        want = shared.get(item.get("variable"))
        if want is not None and canonical(item) != canonical(want):
            found.append((index, item["variable"], want))
    return found


def main():
    args = sys.argv[1:]
    mode = args[0] if args else ""
    if mode == "diff" and len(args) == 2:
        plist = plistlib.loads(sys.stdin.buffer.read())
        for index, variable, item in differences(plist, shared_items(args[1])):
            print(f"{index}\t{variable}\t{json.dumps(item, ensure_ascii=False)}")
        return 0
    if mode == "check" and len(args) == 3:
        plist = plistlib.loads(sys.stdin.buffer.read())
        found = differences(plist, shared_items(args[1]))
        if found:
            names = ", ".join(variable for _, variable, _ in found)
            print(f"{args[2]}: User Configuration differs from shared/userconfig: {names}")
            return 1
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())

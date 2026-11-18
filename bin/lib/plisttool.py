"""Checks and strips values of workflow variables marked "Don't Export".

Alfred stores every workflow environment variable's value in info.plist,
including those ticked "Don't Export"; it only blanks them when exporting.
These helpers do the same for builds and stop such values being committed.

  plisttool.py check <name>   read info.plist from stdin, exit 1 if any
                              "Don't Export" variable has a value
  plisttool.py strip <file>   blank those values in <file>
"""

import plistlib
import sys


def unexported_with_values(plist):
    variables = plist.get("variables", {})
    return [k for k in plist.get("variablesdontexport", []) if variables.get(k)]


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode == "check" and len(sys.argv) == 3:
        names = unexported_with_values(plistlib.loads(sys.stdin.buffer.read()))
        if names:
            print(f"{sys.argv[2]}: \"Don't Export\" variables have values: {', '.join(names)}")
            return 1
        return 0
    if mode == "strip" and len(sys.argv) == 3:
        path = sys.argv[2]
        with open(path, "rb") as f:
            plist = plistlib.load(f)
        names = unexported_with_values(plist)
        if names:
            for k in names:
                plist["variables"][k] = ""
            with open(path, "wb") as f:
                plistlib.dump(plist, f, fmt=plistlib.FMT_XML)
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())

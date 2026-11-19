# CLAUDE.md

Alfred 6 workflows. See README.md for the layout, the `bin/wf` commands and the release process.

## Working on a workflow

Each workflow folder has a `README.md` of developer notes: what the workflow does, how it's built, and anything non-obvious. When asked to work on a workflow (by name, e.g. "Now Playing"; `bin/wf status` maps names to folders), read its README first. When a change makes the README inaccurate or adds something worth knowing, update it in the same change.

## Edits are live

Linked workflows are symlinked into Alfred's workflows directory (which syncs via Dropbox), so any change to a file under `wip/`, `release/` or `gallery/` takes effect in Alfred immediately. Don't leave a workflow half-edited or broken, and don't create scratch files inside workflow folders.

Never touch Alfred's workflows directory directly; go through `bin/wf`. To test `wf` itself, point it at a scratch copy: `ALFRED_WORKFLOWS_DIR=<scratch dir> bin/wf …`, running against a copy of the repo too.

## info.plist

Alfred's workflow editor also writes `info.plist`, so keep edits to it minimal and targeted (`plutil -replace` / `-insert` on specific key paths). Never regenerate or reformat a whole existing file, and check it with `plutil -lint` afterwards. Useful values:

- Script `type`: 0 bash, 5 zsh, 7 JavaScript (JXA), 8 external script (`scriptfile`, relative to the workflow folder, must be executable)
- `scriptargtype`: 1 passes input as argv (`$1`, `argv[0]`)

The user-facing readme ("About this Workflow", the `readme` key in `info.plist`) is written in the workflow's `docs/README.md`, with its images in `docs/`; `bin/wf docs <slug>` copies it into `info.plist`. Edit `docs/README.md`, never the `readme` key itself. See "User-facing docs" in README.md.

## Script conventions

- Keep non-trivial logic in external script files, not inline scripts in `info.plist`, so it can be edited and diffed as normal code.
- Receive input via argv (`scriptargtype` 1), never `{query}` substitution: substitution pastes user text into the script source, which is a shell injection risk.
- Write caches and data to `$alfred_workflow_cache` / `$alfred_workflow_data`, never into the workflow folder.
- Personal settings and API keys go in User Configuration (saved to the gitignored `prefs.plist`), not environment variables, whose values are stored in `info.plist`. The pre-commit hook enforces this.
- Prefer tools that ship with macOS (zsh, JXA, `plutil`) so workflows have no install requirements; vendor any dependencies into the workflow folder.
- Test scripts by running them directly with sample input before relying on Alfred.

## Versioning

Don't edit `version` in `info.plist` by hand; `bin/wf release <slug> <version>` sets it, commits and tags `<slug>/v<version>`, so only run it when asked. Never change the `bundleid` of anything in `release/` or `gallery/`. Only run `wf promote` when asked; moving tiers reflects what has happened publicly.

## Git

Never commit (or run anything that commits) unless explicitly told to; changes are reviewed before committing.

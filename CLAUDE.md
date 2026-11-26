# CLAUDE.md

Alfred 6 workflows. See README.md for the layout, the `bin/wf` commands and the release process.

## Working on a workflow

Each workflow folder has a `DEVELOPMENT.md` of developer notes: what the workflow does, how it's built, and anything non-obvious. When asked to work on a workflow (by name, e.g. "Now Playing"; `bin/wf status` maps names to folders), read its `DEVELOPMENT.md` first. When a change makes it inaccurate or adds something worth knowing, update it in the same change; likewise the user guide in `README.md` when a change affects what users see or configure. A workflow whose `README.md` is still developer notes (no `<!-- end of Alfred readme -->` line) hasn't been moved to this layout yet.

A larger workflow's `DEVELOPMENT.md` is an overview (what it does, how the parts fit together, testing, what's still to do) that links to topic files in its `dev/docs/` folder (e.g. Scratch'n'Stick's `dev/docs/storage.md`, `dev/docs/windows.md`). Read the overview, then the topic files for the area you're working on, and put new detail in the topic file it belongs to, keeping the overview short. If a `DEVELOPMENT.md` grows too long to read in one go, split it the same way.

Developer notes say how the workflow works now, and why, for someone reading them fresh: not a design log. When something changes, rewrite the description rather than appending to it, and leave out dates, "decided"/"proposed" markers, build steps, superseded approaches ("until then…", "was first…") and step-by-step accounts of experiments. Keep the reasons and the facts found (a rejected alternative only if it stops someone trying it again; what an experiment showed, not how it was run). Undocumented Alfred behaviour goes in one place per workflow (Scratch'n'Stick's `dev/docs/alfred-ui.md`). Work still to do goes in a "Still to do" list, not scattered through the notes.

## Edits are live

Linked workflows are symlinked into Alfred's workflows directory (which syncs via Dropbox), so any change to a file under `wip/`, `release/` or `gallery/` takes effect in Alfred immediately. Don't leave a workflow half-edited or broken, and don't create scratch files inside workflow folders.

Never touch Alfred's workflows directory directly; go through `bin/wf`. To test `wf` itself, point it at a scratch copy: `ALFRED_WORKFLOWS_DIR=<scratch dir> bin/wf …`, running against a copy of the repo too.

## info.plist

Alfred's workflow editor also writes `info.plist`, so keep edits to it minimal and targeted (`plutil -replace` / `-insert` on specific key paths). Never regenerate or reformat a whole existing file, and check it with `plutil -lint` afterwards. Useful values:

- Script `type`: 0 bash, 5 zsh, 7 JavaScript (JXA), 8 external script (`scriptfile`, relative to the workflow folder, must be executable)
- `scriptargtype`: 1 passes input as argv (`$1`, `argv[0]`)

User Configuration items whose `variable` is defined in `shared/userconfig/` are shared between workflows: change them in the shared file, then run `bin/wf sync-config`, never in one `info.plist` alone. See "Shared User Configuration" in README.md.

The user-facing readme (the `readme` key in `info.plist`) is copied from the workflow's `README.md`: edit `README.md`, then run `bin/wf sync-readme <slug>`, never the `readme` key or Alfred's "About this Workflow" tab. The part above `<!-- end of Alfred readme -->` must stay within Alfred's Markdown. Its images live in the workflow's `docs/` folder. See "User-facing docs" in README.md.

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

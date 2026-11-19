# Alfred Workflows

Carl's workflows for [Alfred](https://www.alfredapp.com).

## Layout

```
wip/<slug>/         in progress, experiments, may never ship
release/<slug>/     released with a version and posted on the Alfred forum
gallery/<slug>/     accepted into the Alfred Gallery
bin/wf              helper for linking, releasing and building
dist/               built .alfredworkflow files (not committed)
```

Each `<slug>/` folder is the workflow itself, exactly as Alfred sees it (`info.plist` at the root). Workflows are self-contained and don't share code with each other.

Each workflow has a `README.md` of developer notes: how it works, how to test it, to-dos. It isn't included in builds. User-facing documentation goes in the workflow's own readme ("About this Workflow" in Alfred, stored in `info.plist`), which is what Alfred and the Gallery display. It's written in `docs/README.md`; see [User-facing docs](#user-facing-docs).

The three tiers are structured and linked identically; the tier records where a workflow is in its public life. A workflow moves up one tier at a time with `wf promote`, and only workflows with a tagged release can leave `wip/`. Workflows in `release/` and `gallery/` have users, so their bundle IDs must never change.

## Development

Workflows are symlinked from Alfred's workflows directory into this repo, so changes made in Alfred's workflow editor and changes made in the repo are the same files. `wf` finds Alfred's directory from its sync folder setting; set `ALFRED_WORKFLOWS_DIR` to override it.

After cloning, run `bin/wf setup` once to enable the git hooks.

| Command | What it does |
|---|---|
| `wf status` | List workflows, their versions and whether Alfred has them linked |
| `wf adopt <name> <slug>` | Move a workflow made in Alfred into `wip/<slug>` and link it back |
| `wf link <slug>` / `wf unlink <slug>` | Add a repo workflow to Alfred, or remove it (the repo copy is untouched) |
| `wf release <slug> <version>` | Mark a workflow ready for release: set its version, commit, tag `<slug>/v<version>` (and push the tag), and build it |
| `wf docs <slug>` | Write `docs/README.md` into `info.plist` as the workflow's readme; see [User-facing docs](#user-facing-docs) |
| `wf build <slug>` | Update the readme (`wf docs`), then rebuild `dist/<slug>-<version>.alfredworkflow` at the current version |
| `wf promote <slug>` | Move a workflow up a tier: `wip/` → `release/` → `gallery/` |

To start a new workflow, create it in Alfred, then `wf adopt` it.

If a link is ever broken, even briefly (for example while moving or renaming the repo), Alfred Preferences drops the workflow and doesn't notice when the link works again. Quit and reopen Alfred Preferences, and Alfred itself if the workflow's keywords are missing.

### What goes into a build

A build contains the files git tracks or would track in the workflow folder, minus its `README.md` and anything matched by an optional `.wfignore` in that folder (one glob pattern per line, for repo-only files such as tests or notes). When there's a `docs/README.md`, only the images it shows ship from `docs/`: the README itself is already in `info.plist`, and the build lists any other files there that it leaves out. Values of variables marked "Don't Export" are blanked, as Alfred's own export does.

### User-facing docs

A workflow's readme ("About this Workflow" in Alfred, and its page in the Gallery) is the `readme` string in `info.plist`. Rather than editing that string, write it as Markdown in the workflow's `docs/README.md`, with the images it shows (screenshots and so on) next to it in `docs/`:

```
wip/<slug>/docs/README.md      the readme, in Markdown
wip/<slug>/docs/*.png          images it shows, as ![Alt text](shot.png)
```

`wf docs <slug>` writes `docs/README.md` into `info.plist` and reloads the workflow in Alfred if it's linked. `wf build` and `wf release` run it first, so builds and releases always carry the current readme, and `wf release` commits it with the version. A workflow without `docs/README.md` keeps whatever readme `info.plist` has.

Alfred shows only local images, at paths relative to the workflow folder, so `wf docs` rewrites each image path written relative to `docs/` (`shot.png` becomes `docs/shot.png`). It stops with an error if an image is missing or outside the workflow folder. It rewrites only inline images (`![alt](path)`, `![alt](<path with spaces>)`, `![alt](path "title")`), not reference-style ones (`![alt][ref]`) or anything in fenced code blocks; URLs and absolute paths are left as they are, though Alfred won't show them. See [Alfred's Markdown syntax](https://www.alfredapp.com/help/kb/markdown-syntax/) for what the readme can use (no raw HTML apart from `<kbd>`).

Things to know:

- `docs/README.md` is the source. In Alfred 6 the readme can also be edited in the workflow editor's [𝒙] sheet ("About this Workflow" tab); edits made there are overwritten by the next `wf docs`, so copy any you want to keep into `docs/README.md`. The workflow's configuration sheet shows the rendered readme beside the settings, which is a quick way to check it after `wf docs`.
- Alfred's workflow editor keeps its own copy of `info.plist` while the workflow is open in it, and saving there writes that copy back. After `wf docs`, check that the readme is current in Alfred Preferences before editing the workflow there, or reopen Alfred Preferences.
- Every image in a build adds to its download, so keep screenshots small (crop them, and compress PNGs with a tool such as ImageOptim or TinyPNG).

## Personal settings and secrets

- **User Configuration** (the workflow's configuration sheet in Alfred): field definitions and defaults live in `info.plist` and are committed; the values entered are saved to `prefs.plist`, which is gitignored and never built. Put API keys and other personal settings here.
- **Environment variables**: values are stored in `info.plist` itself, even when "Don't Export" is ticked, so they would be committed. The pre-commit hook blocks any commit where a "Don't Export" variable has a value, and also blocks any `prefs.plist`.
- **Runtime data**: scripts should write caches and data to `$alfred_workflow_data` / `$alfred_workflow_cache`, which are outside the workflow folder, never into the workflow folder itself.

## Releasing

1. Commit all changes to the workflow.
2. `bin/wf release <slug> <version>`. This updates the readme from `docs/README.md`, locks the version with a git tag, pushes the tag to `origin`, and writes the `.alfredworkflow` to `dist/`. The branch itself isn't pushed.
3. Post it on the Alfred forum. For a first release, then run `bin/wf promote <slug>` to move it from `wip/` to `release/`.
4. Submit it to the Gallery. Once it's accepted, run `bin/wf promote <slug>` to move it to `gallery/`.

New versions of a workflow already in `release/` or `gallery/` follow steps 1–2 and are posted or submitted as updates; the workflow stays in its tier.

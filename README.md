# Alfred Workflows

Carl's workflows for [Alfred](https://www.alfredapp.com).

## Published workflows

Workflows in the [Alfred Gallery](https://alfred.app) come first, then those released on the Alfred forum.

- [Now Playing](release/now-playing/README.md): see the status of currently playing media, and launch a mini player panel.

## Layout

```
wip/<slug>/         in progress, experiments, may never ship
release/<slug>/     released with a version and posted on the Alfred forum
gallery/<slug>/     accepted into the Alfred Gallery
bin/wf              helper for linking, releasing and building
bin/make-appicon    builds an Alfred UI's app icon from a workflow's icon
dist/               built .alfredworkflow files (not committed)
```

Each `<slug>/` folder is the workflow itself, exactly as Alfred sees it (`info.plist` at the root). Workflows are self-contained and don't share code with each other.

Each workflow has a `README.md` of developer notes: how it works, how to test it, to-dos. It isn't included in builds. User-facing documentation goes in the workflow's own readme ("About this Workflow" in Alfred, stored in `info.plist`), which is what Alfred and the Gallery display; see [User-facing docs](#user-facing-docs).

The three tiers are structured and linked identically; the tier records where a workflow is in its public life. A workflow moves up one tier at a time with `wf promote`, and only workflows with a tagged release can leave `wip/`. Workflows in `release/` and `gallery/` have users, so their bundle IDs must never change.

## Development

Workflows are symlinked from Alfred's workflows directory into this repo, so changes made in Alfred's workflow editor and changes made in the repo are the same files. `wf` finds Alfred's directory from its sync folder setting; set `ALFRED_WORKFLOWS_DIR` to override it.

After cloning, run `bin/wf setup` once to enable the git hooks.

| Command | What it does |
|---|---|
| `wf status` | List workflows, their versions and whether Alfred has them linked |
| `wf adopt <name> <slug>` | Move a workflow made in Alfred into `wip/<slug>` and link it back |
| `wf link <slug>` / `wf unlink <slug>` | Add a repo workflow to Alfred, or remove it (the repo copy is untouched) |
| `wf release [--allow-unsigned] <slug> <version>` | Mark a workflow ready for release: set its version, commit, tag `<slug>/v<version>` (and push the tag), build it, and open a draft GitHub release with the build attached |
| `wf build [--allow-unsigned] <slug>` | Rebuild `dist/<slug>-<version>.alfredworkflow` at the current version; see [Compiled binaries](#compiled-binaries) |
| `wf promote <slug>` | Move a workflow up a tier: `wip/` → `release/` → `gallery/` |

To start a new workflow, create it in Alfred, then `wf adopt` it.

If a link is ever broken, even briefly (for example while moving or renaming the repo), Alfred Preferences drops the workflow and doesn't notice when the link works again. Quit and reopen Alfred Preferences, and Alfred itself if the workflow's keywords are missing.

### What goes into a build

A build contains the files git tracks or would track in the workflow folder, minus its `README.md` and anything matched by an optional `.wfignore` in that folder (one glob pattern per line, for repo-only files such as tests or notes). Values of variables marked "Don't Export" are blanked, as Alfred's own export does.

### Compiled binaries

Any compiled (Mach-O) binary in a build must be signed with a Developer ID certificate and notarised. A browser quarantines a downloaded `.alfredworkflow`, Alfred can carry the quarantine onto the imported files, and Gatekeeper then refuses to load a binary that isn't notarised; the Alfred Gallery requires it too. `wf build` and `wf release` check every shipped binary with `spctl` and fail if it isn't accepted as `Notarized Developer ID`; `wf release` checks before committing or tagging anything. Frameworks and bare binaries can't have their notarisation ticket stapled, so the check looks it up online and needs a network connection. For a local test build, `wf build --allow-unsigned <slug>` warns instead of failing. `wf release --allow-unsigned <slug> <version>` does the same for a test release, but only for a pre-release version (`1.2.3-preview.1`); its draft GitHub release is marked as a pre-release and its notes start with a warning that it's unsigned. Don't promote a workflow on an unsigned preview.

### User-facing docs

A workflow's readme ("About this Workflow" in Alfred, and its page in the Gallery) is the `readme` string in `info.plist`. Write it in Alfred: in the workflow editor, the [𝒙] sheet's "About this Workflow" tab. The workflow's configuration sheet shows it rendered beside the settings.

The readme can use [Alfred's Markdown](https://www.alfredapp.com/help/kb/markdown-syntax/) (no raw HTML apart from `<kbd>`). Images must be files in the workflow, at paths relative to the workflow folder; keep them in `docs/` and write them as `![Alt text](docs/shot.png)`. Everything in `docs/` ships in builds, so remove screenshots the readme no longer shows, and keep them small (crop them, and compress PNGs with a tool such as ImageOptim or TinyPNG).

### App icons

An Alfred UI runs in a helper app with no icon of its own, so a workflow with a window gives it one with `ui.json`'s `iconpath` (see Now Playing's README, [App icon and name](release/now-playing/README.md#app-icon-and-name)). `bin/make-appicon <icon.png> <appicon.png>` builds it from the workflow's icon, laid out on the macOS icon grid with a squircle mask and drop shadow so it matches other apps' icons.

## Personal settings and secrets

- **User Configuration** (the workflow's configuration sheet in Alfred): field definitions and defaults live in `info.plist` and are committed; the values entered are saved to `prefs.plist`, which is gitignored and never built. Put API keys and other personal settings here.
- **Environment variables**: values are stored in `info.plist` itself, even when "Don't Export" is ticked, so they would be committed. The pre-commit hook blocks any commit where a "Don't Export" variable has a value, and also blocks any `prefs.plist`.
- **Runtime data**: scripts should write caches and data to `$alfred_workflow_data` / `$alfred_workflow_cache`, which are outside the workflow folder, never into the workflow folder itself.

## Releasing

1. Commit all changes to the workflow.
2. `bin/wf release <slug> <version>`. This locks the version with a git tag, pushes the tag to `origin`, and writes the `.alfredworkflow` to `dist/`. The branch itself isn't pushed. It then creates a draft GitHub release for the tag, with the build attached and notes listing the workflow's commits since its previous release, and opens the draft's edit page in the browser. A draft isn't public. Versions with a suffix (`1.2.3-beta.1`) are marked as pre-releases, and no release is marked "Latest", since that label is repo-wide. Without `gh`, or if creating it fails, `wf` says so and prints the command to retry.
3. Edit the notes and publish the draft on GitHub. Its download link, `https://github.com/CarlosNZ/alfred-workflows/releases/download/<slug>/v<version>/<slug>-<version>.alfredworkflow`, stays the same for that version.
4. Post it on the Alfred forum. For a first release, then run `bin/wf promote <slug>` to move it from `wip/` to `release/`, and add it to [Published workflows](#published-workflows), after any Gallery workflows.
5. Submit it to the Gallery. Once it's accepted, run `bin/wf promote <slug>` to move it to `gallery/`, and move it up in [Published workflows](#published-workflows), linking to its new folder.

New versions of a workflow already in `release/` or `gallery/` follow steps 1–3 and are posted or submitted as updates; the workflow stays in its tier.

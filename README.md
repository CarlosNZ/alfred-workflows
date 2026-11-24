# Alfred Workflows

Carl's workflows for [Alfred](https://www.alfredapp.com).

## Published workflows

- [Now Playing](release/now-playing): see the status of currently playing media, and launch a mini player panel.
- [World Clock Cities](release/world-clock-cities): see the status of currently playing media, and launch a mini player panel.

## Layout

```
wip/<slug>/         in progress, experiments, may never ship
release/<slug>/     released with a version and posted on the Alfred forum
gallery/<slug>/     accepted into the Alfred Gallery
bin/                developer scripts: wf (linking, releasing and building) and icon tools
shared/userconfig/  User Configuration options that several workflows offer, worded the same
dist/               built .alfredworkflow files (not committed)
```

Each `<slug>/` folder is the workflow itself, exactly as Alfred sees it (`info.plist` at the root). Workflows are self-contained and don't share code with each other. Only the wording of some User Configuration options is shared, and each workflow keeps its own copy; see [Shared User Configuration](#shared-user-configuration).

Each workflow's `README.md` is its user guide, which GitHub shows in the workflow's folder, and `wf` copies it into the workflow's readme in `info.plist`, which is what Alfred and the Gallery display; see [User-facing docs](#user-facing-docs). Its `DEVELOPMENT.md` holds the developer notes: how it works, how to test it, to-dos. Neither file is included in builds.

The three tiers are structured and linked identically; the tier records where a workflow is in its public life. A workflow moves up one tier at a time with `wf promote`, and only workflows with a tagged release can leave `wip/`. Workflows in `release/` and `gallery/` have users, so their bundle IDs must never change.

## Development

Workflows are symlinked from Alfred's workflows directory into this repo, so changes made in Alfred's workflow editor and changes made in the repo are the same files. `wf` finds Alfred's directory from its sync folder setting; set `ALFRED_WORKFLOWS_DIR` to override it.

After cloning, run `bin/wf setup` once to enable the git hooks.

| Command                                          | What it does                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wf status`                                      | List workflows, their versions and whether Alfred has them linked                                                                                                                                                                                                                                                                                                 |
| `wf adopt <name> <slug>`                         | Move a workflow made in Alfred into `wip/<slug>` and link it back                                                                                                                                                                                                                                                                                                 |
| `wf link <slug>` / `wf unlink [--clean] <slug>`  | Add a repo workflow to Alfred, or remove it (the repo copy is untouched). `--clean` also moves the workflow's data and cache folders to the Trash; see [Testing a fresh install](#testing-a-fresh-install)                                                                                                                                                        |
| `wf release [--allow-unsigned] <slug> <version>` | Mark a workflow ready for release: set its version, commit, tag `<slug>/v<version>` (and push the tag), build it, and open a draft GitHub release with the build attached                                                                                                                                                                                         |
| `wf build [--allow-unsigned] <slug>`             | Sync the workflow's `info.plist` (as `sync-config` and `sync-readme` do), then build `dist/<slug>-<version>.alfredworkflow` at the current version, or `dist/<slug>-unversioned.alfredworkflow` before the first release, to try a build before releasing it. It warns when the build isn't exactly a tagged release; see [Compiled binaries](#compiled-binaries) |
| `wf promote <slug>`                              | Move a workflow up a tier: `wip/` → `release/` → `gallery/`                                                                                                                                                                                                                                                                                                       |
| `wf sync-config [<slug>]`                        | Copy the shared User Configuration options into every workflow that uses them, or only into one; see [Shared User Configuration](#shared-user-configuration)                                                                                                                                                                                                      |
| `wf sync-readme [--force] [<slug>]`              | Copy each workflow's user guide from `README.md` into its `info.plist`, or only one's; see [User-facing docs](#user-facing-docs)                                                                                                                                                                                                                                  |

To start a new workflow, create it in Alfred, then `wf adopt` it.

If a link is ever broken, even briefly (for example while moving or renaming the repo), Alfred Preferences drops the workflow and doesn't notice when the link works again. Quit and reopen Alfred Preferences, and Alfred itself if the workflow's keywords are missing.

### Testing a fresh install

Never delete a linked workflow in Alfred, and never install its bundle while it's linked: Alfred follows the link, so deleting removes the repo folder and installing ("Update") overwrites it. To try a build as a new user would:

1. `wf unlink --clean <slug>` removes the link and moves the workflow's data and cache folders to the Trash.
2. `wf build <slug>`, then open the bundle in `dist/`. It installs as an ordinary folder without your `prefs.plist` (which is gitignored, so never built), so Alfred asks for User Configuration as on a first install.
3. When done, delete the installed copy in Alfred (safe, as it isn't a link; this also removes its data and cache), then `wf link <slug>`. Your settings come back with the repo's `prefs.plist`. `wf link` refuses while the installed copy is still there.

### What goes into a build

A build contains the files git tracks or would track in the workflow folder, minus its `README.md` and `DEVELOPMENT.md` and anything matched by an optional `.wfignore` in that folder (one glob pattern per line, for repo-only files such as tests or notes; a pattern also matches everything under a folder it names, and may end in a slash, as in `.gitignore`). Values of variables marked "Don't Export" are blanked, as Alfred's own export does.

### Compiled binaries

Any compiled (Mach-O) binary in a build must be signed with a Developer ID certificate and notarised. A browser quarantines a downloaded `.alfredworkflow`, Alfred can carry the quarantine onto the imported files, and Gatekeeper then refuses to load a binary that isn't notarised; the Alfred Gallery requires it too. `wf build` and `wf release` check every shipped binary with `spctl` and fail if it isn't accepted as `Notarized Developer ID`; `wf release` checks before committing or tagging anything. Frameworks and bare binaries can't have their notarisation ticket stapled, so the check looks it up online and needs a network connection. For a local test build, `wf build --allow-unsigned <slug>` warns instead of failing. `wf release --allow-unsigned <slug> <version>` does the same for a test release, but only for a pre-release version (`1.2.3-preview.1`); its draft GitHub release is marked as a pre-release and its notes start with a warning that it's unsigned. Don't promote a workflow on an unsigned preview.

### User-facing docs

A workflow's user guide is its `README.md`, which GitHub shows when someone opens the workflow's folder. Alfred shows its readme in the workflow's "About this Workflow" tab and its configuration sheet, and the Gallery on the workflow's page; that's the `readme` string in `info.plist`, which `wf sync-readme` copies from `README.md`:

```markdown
# World Clock

**[Download v1.2.0](https://github.com/CarlosNZ/alfred-workflows/releases/download/world-clock/v1.2.0/world-clock-1.2.0.alfredworkflow)**

<!-- start of Alfred readme -->

## Usage
…the readme Alfred shows…

<!-- end of Alfred readme -->

---

For how the workflow is built, see the [developer notes](DEVELOPMENT.md).
```

Alfred gets everything between the `<!-- start of Alfred readme -->` line and the `<!-- end of Alfred readme -->` line. Without a start line, it gets everything after the title (a first line starting `# `, which Alfred doesn't need, as it shows the workflow's name). The rest is for GitHub only, such as the download link and the link to `DEVELOPMENT.md`; GitHub hides the markers themselves. A `README.md` without the marker isn't treated as a user guide, and `wf` leaves the workflow's readme alone.

Edit `README.md`, then run `bin/wf sync-readme <slug>` and look at the result in Alfred's configuration sheet. Don't edit the readme in Alfred: `sync-readme` refuses to overwrite a readme that matches neither what it last wrote nor the last commit, and shows the difference, so copy any edits made there into `README.md` and run `bin/wf sync-readme --force <slug>`. `wf build` and `wf release` sync first, and `wf release` stops if that changed anything, so the change can be committed before the release is tagged. The pre-commit hook blocks a commit where a workflow's readme differs from its `README.md`.

Once a workflow has a published GitHub release that isn't a pre-release, its `README.md` must link to the `.alfredworkflow` of the latest one (by version number) in its GitHub-only part, conventionally as a bold "Download" line under the title, above the start marker, as in the example. The pre-commit hook fetches the releases with `gh` on every commit, and blocks the commit while any workflow's `README.md` is missing the link to its latest release, printing the line to add. The tag's slash in the URL may be written as `/` or `%2F`. Without `gh` or a network connection, the hook warns and skips the check.

The part Alfred gets can only use [Alfred's Markdown](https://www.alfredapp.com/help/kb/markdown-syntax/) (no raw HTML apart from `<kbd>`, which GitHub shows too), so no tables, and no links to other files in the repo, which mean nothing inside Alfred; link to web pages, or put such links in the GitHub-only part. Images must be files in the workflow, at paths relative to the workflow folder, which work on GitHub too; keep them in `docs/` and write them as `![Alt text](docs/shot.png)`. Everything in `docs/` ships in builds, so remove screenshots the readme no longer shows, and keep them small (crop them, and compress PNGs with a tool such as ImageOptim or TinyPNG).

### Shared User Configuration

Options that several workflows offer, such as the window buttons, corner radius and transparency of an Alfred UI window, are worded the same in each. Their definitions live in `shared/userconfig/`, one JSON file per group of options (`window.json` for those three). Each file is a list of User Configuration items exactly as they appear in `info.plist`'s `userconfigurationconfig`, in JSON. A workflow uses a shared option by having an item with the same `variable`, and keeps its own copy of it in `info.plist`, so builds stay self-contained. Where the options go in the configuration sheet is up to each workflow.

To change an option's wording or settings, edit the shared file and run `bin/wf sync-config`, which copies each shared item over every workflow's item with that variable, and leaves the rest of `info.plist` alone. An edit to a shared option made in Alfred's workflow editor is undone by the next sync. The pre-commit hook blocks a commit where any workflow's copy differs from the shared one.

To give a workflow a shared option, add an item with its variable in Alfred (anything will do for the rest) and run `bin/wf sync-config`, or append it to `userconfigurationconfig` with `plutil -insert … -append`. The workflow's scripts still read the option and apply their own default, which should match the shared default.

### App icons

An Alfred UI runs in a helper app with no icon of its own, so a workflow with a window gives it one with `ui.json`'s `iconpath` (see Now Playing's developer notes, [App icon and name](release/now-playing/DEVELOPMENT.md#app-icon-and-name)). `bin/make-appicon <icon.png> <appicon.png>` builds it from the workflow's icon, laid out on the macOS icon grid with a squircle mask and drop shadow so it matches other apps' icons.

## Personal settings and secrets

- **User Configuration** (the workflow's configuration sheet in Alfred): field definitions and defaults live in `info.plist` and are committed; the values entered are saved to `prefs.plist`, which is gitignored and never built. Put API keys and other personal settings here.
- **Environment variables**: values are stored in `info.plist` itself, even when "Don't Export" is ticked, so they would be committed. The pre-commit hook blocks any commit where a "Don't Export" variable has a value, and also blocks any `prefs.plist`.
- **Runtime data**: scripts should write caches and data to `$alfred_workflow_data` / `$alfred_workflow_cache`, which are outside the workflow folder, never into the workflow folder itself.

## Releasing

For a short list of what to check and do, see [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md).

1. Commit all changes to the workflow.
2. `bin/wf release <slug> <version>`. This locks the version with a git tag, pushes the tag to `origin`, and writes the `.alfredworkflow` to `dist/`. The branch itself isn't pushed. It then creates a draft GitHub release for the tag, with the build attached and notes listing the workflow's commits since its previous release, and opens the draft's edit page in the browser. A draft isn't public. Versions with a suffix (`1.2.3-beta.1`) are marked as pre-releases, and no release is marked "Latest", since that label is repo-wide. Without `gh`, or if creating it fails, `wf` says so and prints the command to retry.
3. Edit the notes and publish the draft on GitHub. Its download link, `https://github.com/CarlosNZ/alfred-workflows/releases/download/<slug>/v<version>/<slug>-<version>.alfredworkflow`, stays the same for that version. Unless it's a pre-release, update the download link at the top of the workflow's `README.md` to it and commit that; the pre-commit hook blocks commits until it's done (see [User-facing docs](#user-facing-docs)).
4. Post it on the Alfred forum. For a first release, then run `bin/wf promote <slug>` to move it from `wip/` to `release/`, and add it to [Published workflows](#published-workflows), after any Gallery workflows.
5. Submit it to the Gallery. Once it's accepted, run `bin/wf promote <slug>` to move it to `gallery/`, and move it up in [Published workflows](#published-workflows), linking to its new folder.

New versions of a workflow already in `release/` or `gallery/` follow steps 1–3 and are posted or submitted as updates; the workflow stays in its tier.

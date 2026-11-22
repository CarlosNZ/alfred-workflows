# Release checklist

For a new workflow or a new version of one. The details of each step are in [Releasing](README.md#releasing) in the README.

## Before releasing

- [ ] Try it in Alfred, including a first run with the default settings.
- [ ] Hotkeys are unassigned, and the User Configuration defaults make sense for someone else.
- [ ] Name, description, category, icon and creator are set in the workflow's settings in Alfred.
- [ ] The user guide (`README.md`) covers what's new and any new options, and its screenshots in `docs/` are up to date. Delete screenshots it no longer uses.
- [ ] `DEVELOPMENT.md` is up to date, and its to-dos are done or still apply.
- [ ] Compiled binaries are signed and notarised.
- [ ] `bin/wf build <slug>` works, and the build contains only what it should.
- [ ] Everything is committed.

## Release

- [ ] `bin/wf release <slug> <version>`. Use a `-preview.N` version for a test release.
- [ ] Edit the notes of the draft GitHub release, and publish it.
- [ ] Merge the branch into `main` and push it. The release only pushes the tag.

## Publish

- [ ] Alfred forum: post a new thread for a first release, or an update in the workflow's thread, with the download link.
- [ ] First release: `bin/wf promote <slug>`, add it to Published workflows in the README, and add the forum link to the GitHub part of the workflow's `README.md`.
- [ ] Alfred Gallery: submit it, or submit the update. Once a first submission is accepted, `bin/wf promote <slug>` and move it up in Published workflows.

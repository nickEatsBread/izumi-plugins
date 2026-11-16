# Contributing

**Listing a plugin, source or pack:** follow [Submitting a plugin, a source or a pack](README.md#submitting-a-plugin-a-source-or-a-pack).
One listing per pull request, opened by its author or maintainer, with the template filled in.

**Updating a listing:** new commits are picked up automatically
([Updates](README.md#updates)). Open a pull request only for a plugin asking for different
permissions, a new signing key, or a change to `repo`, `branch`, `plugin`, `store`, `pack` or
`themes`, and say why.

**Reporting a listing:** open an issue saying which listing and what's wrong. Report security
problems in a plugin or source to its author as well.

**Changing izumi's own plugins** (`official/`): open a pull request. Run
`node scripts/pin-main.mjs official/<name>` after changing a main file.

**Changing the tooling or docs:** keep `scripts/lib.mjs` in step with izumi's plugin runtime,
package installer and pack format, add a test in `scripts/lib.test.mjs` for any new rule, and run `npm test`.

By contributing you agree that your contributions to this repository's tooling and documentation
are licensed under its [MIT licence](LICENSE). Listed plugins, sources and packs keep their own licences.

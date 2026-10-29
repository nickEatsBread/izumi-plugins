# Contributing

**Listing a plugin or pack:** follow [Submitting a plugin or a pack](README.md#submitting-a-plugin-or-a-pack).
One listing per pull request, opened by its author or maintainer, with the template filled in.

**Updating a listing:** new commits are picked up automatically
([Updates](README.md#updates)). Open a pull request only for a new signing key or a change to
`repo`, `branch`, `store`, `pack` or `themes`, and say why.

**Reporting a listed plugin:** open an issue saying which listing and what's wrong. Report security
problems in a plugin to its author as well.

**Changing the tooling or docs:** keep `scripts/lib.mjs` in step with izumi's package installer and
pack format, add a test in `scripts/lib.test.mjs` for any new rule, and run `npm test`.

By contributing you agree that your contributions to this repository's tooling and documentation
are licensed under its [MIT licence](LICENSE). Listed plugins and packs keep their own licences.

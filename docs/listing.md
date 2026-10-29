# Listings

A listing tells this repository where a plugin or pack lives and which commit was last checked. It
is the only file you write; `store.json` and `packs/<id>/pack.json` are generated from the listings.

## A plugin: `plugins/<id>/listing.json`

```json
{
  "id": "example.my-source",
  "repo": "you/my-source",
  "branch": "main",
  "store": "izumi/store.json",
  "commit": "0123456789abcdef0123456789abcdef01234567",
  "signingKey": "filled in by npm run build",
  "themes": ["example.my-look"]
}
```

| Field | Meaning |
| --- | --- |
| `id` | The source's id in your store, and the folder name. |
| `repo` | Your public GitHub repository, `owner/name`. |
| `branch` | The branch this repository follows for updates. Defaults to `main`. |
| `store` | Path of your `store.json` in the repository. |
| `commit` | The full SHA of the commit to list. The update job moves it; you set it when you first submit. |
| `signingKey` | Fingerprint of the key your packages are signed with (hex SHA-256 of the raw Ed25519 key, as izumi shows it). `npm run build` records it. |
| `themes` | Optional. Themes from the same store that a pack needs; they are listed too. |
| `updatedAt` | Written by the update job: the date of the pinned commit. |

## A pack: `packs/<id>/listing.json`

```json
{
  "id": "example.my-pack",
  "repo": "you/my-source",
  "branch": "main",
  "pack": "izumi/pack.json",
  "commit": "0123456789abcdef0123456789abcdef01234567"
}
```

## What is checked

At the pinned commit, for every listing (`npm test`, and CI on every pull request):

- the store index or pack is valid, and names the listed id;
- every file it points to downloads, with exactly the listed size and SHA-256;
- every package is what izumi's installer accepts: the five files, matching id, version, backend
  and platform, a correct `integrity.json`, and an Ed25519 signature that verifies;
- every build of a plugin is signed with the same key, and that key is the listing's `signingKey`;
- every store a pack installs from is pinned here (or is the izumi theme catalog), and every item
  it installs is listed;
- in CI, ClamAV scans every downloaded file: packages, themes and startup videos. Anything flagged,
  and anything too large to scan, fails.

## Updates

Once a listing is merged, you don't need another pull request for new versions. Every hour the
update job looks at the newest commit on each listing's branch. If it differs from the pin, the job
runs every check above and the virus scan on that commit:

- **Passes:** the pin moves to the new commit and `store.json` is regenerated. izumi offers the new
  version the next time it checks the store.
- **Fails:** the pin stays where it was, and the job opens an issue named
  `Update held: <owner>/<repo>` with the reasons. Push a fixed commit and the next run tries again;
  the issue closes when a commit passes.

Every commit on the followed branch can reach users within the hour. If you want to choose when a
release goes out, follow a release branch (`"branch": "release"`) and merge into it when you're
ready.

Listings from the same repository and branch move together, so a pack and its plugin always match.

These changes need a pull request and a maintainer's review instead:

- a new signing key (the update job holds it back);
- a different `repo`, `branch`, `store` or `pack`;
- adding or removing `themes`.

## Delisting

Maintainers remove a listing that breaks the rules, or at its author's request. izumi keeps
installed copies, but they get no more updates from this store.

# izumi plugins

The official marketplace for izumi plugins and packs. izumi lists it in **Settings → Store** as
*izumi plugins*. Nothing here is installed by default: people browse it and choose what to install.

Each listing points at its author's own repository and pins one commit of it. Everything izumi
installs through a listing is read at that commit and checked: every file against its size and
SHA-256, every package against the format izumi installs and its author's signing key, and all of it
through a virus scan. New commits are picked up automatically once they pass the same checks.

- **Building a plugin:** [docs/building-a-plugin.md](docs/building-a-plugin.md)
- **Building a pack:** [docs/building-a-pack.md](docs/building-a-pack.md)
- **Listings, checks and updates:** [docs/listing.md](docs/listing.md)
- **Running your own marketplace:** [docs/running-a-marketplace.md](docs/running-a-marketplace.md)
- **Themes** have their own catalog: [izumi-themes](https://github.com/nickEatsBread/izumi-themes).

## What is listed here

- **Plugins**: sources packaged as signed `.izumi-ext` files, either a JavaScript module
  (`izumi-js`) or a local service with one build per platform (`izumi-service`).
- **Packs**: one link that sets izumi up with listed plugins, a theme, a startup video and setup
  steps.

Not listed here: themes on their own (see izumi-themes), remote addons that users add by link, and
private forks of someone else's plugin.

## What gets accepted

A listing has to meet all of these. Reviewers can ask for changes, and can delist anything that stops
meeting them later.

1. **You wrote it or maintain it.** Listing someone else's work needs their agreement.
2. **Open source.** The repository is public and has a licence, and the packages are built from the
   source at the listed commit.
3. **Legitimate content.** A source connects people to content they are entitled to watch: their own
   account with a service, media they own, or content its rights holders make freely available.
   Plugins built to reach unlicensed copies, or to get around a service's payment, region or
   account rules, are not accepted.
4. **Signed.** Every package is signed with Ed25519, and every release uses the same key.
5. **Nothing hidden.** No malware or miners, no tracking or analytics the user didn't opt into, no
   downloading and running code that isn't in the package, and no network use beyond what the
   plugin's job needs.
6. **User data stays the user's.** Sign-in details and tokens go only to the service they belong to,
   and a local service keeps its data in the folder izumi gives it.
7. **An honest listing.** The name and description say what it does and what it needs (an account, a
   key, a subscription). Adult content is marked `nsfw`.

## Submitting a plugin or a pack

1. **Build and publish it in your own repository.** Follow
   [building a plugin](docs/building-a-plugin.md) (and [building a pack](docs/building-a-pack.md)).
   Your repository publishes a `store.json`, and its packages as release assets.
2. **Install it from your own link.** In izumi, open **Settings → Store → Add store**, paste the raw
   link to your `store.json`, install, and play something. For a pack, open
   `izumi://pack?url=<link to pack.json>`.
3. **Fork this repository and add a listing.** One folder per plugin or pack:

   ```
   plugins/<id>/listing.json
   packs/<id>/listing.json
   ```

   ```json
   {
     "id": "example.my-source",
     "repo": "you/my-source",
     "branch": "main",
     "store": "izumi/store.json",
     "commit": "<the full SHA of the commit to list>"
   }
   ```

   [docs/listing.md](docs/listing.md) has every field.
4. **Build and test.** With Node.js 22.16 or newer:

   ```sh
   npm install
   npm run build   # checks your listing, records your signing key, regenerates store.json
   npm test
   ```

5. **Open a pull request** and fill in the template. CI runs the same checks plus a virus scan.

## Review

A maintainer reads the source at the listed commit, checks it against the rules above, installs it,
and tries it. Reviews are done by volunteers, so they take as long as they take; a small, clear plugin
with a good description is quicker to review. Questions and requested changes go in the pull request.

## Updates

After your listing is merged, you don't open pull requests for new versions. Every hour, an update
job checks the newest commit on your listing's branch with the same checks and virus scan:

- if it passes, the pin moves and izumi offers the new version the next time it checks the store;
- if it doesn't, the old pin stays, and an issue named `Update held: <owner>/<repo>` explains why.
  Push a fixed commit and the next run tries again.

Every commit on the followed branch can reach users within the hour, so follow a release branch if
you want to choose when a version ships. A new signing key, or a change to `repo`, `branch`, `store`,
`pack` or `themes`, needs a pull request and a review.

## Repository layout

```
marketplace.json        which marketplace this is (forks change it)
store.json              the index izumi reads (generated)
plugins/<id>/listing.json
packs/<id>/listing.json
packs/<id>/pack.json    the pack izumi reads, pinned to this store (generated)
docs/                   guides for authors and marketplace owners
scripts/lib.mjs         the checks
scripts/build.mjs       npm run build / npm test
scripts/update.mjs      the hourly update
.github/                CI: validate pull requests, update pins, ClamAV setup
```

## Development

```sh
npm install
npm test                   # unit tests, then every listing at its pin
node scripts/build.mjs --scan   # also run ClamAV (needs clamscan on PATH)
```

`scripts/lib.mjs` mirrors the rules of izumi's package installer
(`src-tauri/src/extension_package.rs`) and pack format (`src/lib/packs/format.ts`). A change to either
in izumi needs the same change here.

## Licence

The tooling and documentation are [MIT](LICENSE). Each plugin and pack keeps its own licence, set in
its own repository; listing it here doesn't transfer ownership.

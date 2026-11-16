# izumi plugins

The official marketplace for izumi plugins, sources and packs. Nothing here is installed by
default: people browse it in izumi and choose what to install.

Each listing points at its author's own repository and pins one commit of it. Everything izumi
installs through a listing is read at that commit and checked: every file against its size and
SHA-256, every plugin against the rules of izumi's plugin runtime, every package against the format
izumi installs and its author's signing key, and all of it through a virus scan. New commits are
picked up automatically once they pass the same checks.

- **Building a plugin:** [docs/building-a-plugin.md](docs/building-a-plugin.md)
- **Building a source:** [docs/building-a-source.md](docs/building-a-source.md)
- **Building a pack:** [docs/building-a-pack.md](docs/building-a-pack.md)
- **Listings, checks and updates:** [docs/listing.md](docs/listing.md)
- **Running your own marketplace:** [docs/running-a-marketplace.md](docs/running-a-marketplace.md)
- **Themes** have their own catalog: [izumi-themes](https://github.com/nickEatsBread/izumi-themes).

## What is listed here

- **Plugins**: features that run in izumi's plugin sandbox, such as
  [Jump to a moment](official/jump-to-moment/). A plugin is a `plugin.json` and one JavaScript
  module. izumi lists them under **Settings → Sources and store → Plugins**.
- **Sources**: sources packaged as signed `.izumi-ext` files, either a JavaScript module
  (`izumi-js`) or a local service with one build per platform (`izumi-service`). izumi lists them
  in **Settings → Store**.
- **Packs**: one link that sets izumi up with listed sources, a theme, a startup video and setup
  steps. izumi lists them in **Settings → Store**.

Not listed here: themes on their own (see izumi-themes), remote addons that users add by link, and
private forks of someone else's work.

## What gets accepted

A listing has to meet all of these. Reviewers can ask for changes, and can delist anything that stops
meeting them later.

1. **You wrote it or maintain it.** Listing someone else's work needs their agreement.
2. **Open source.** The repository is public and has a licence, and what izumi installs is built
   from the source at the listed commit.
3. **Legitimate content.** A source connects people to content they are entitled to watch: their own
   account with a service, media they own, or content its rights holders make freely available.
   Sources built to reach unlicensed copies, or to get around a service's payment, region or
   account rules, are not accepted.
4. **Signed sources.** Every source package is signed with Ed25519, and every release uses the same
   key. A plugin's main file is pinned by its SHA-256 in `plugin.json`.
5. **Nothing hidden.** No malware or miners, no tracking or analytics the user didn't opt into, no
   downloading and running code that isn't in the package, and no network use beyond what the job
   needs. A plugin asks only for the permissions it uses.
6. **User data stays the user's.** Sign-in details, keys and tokens go only to the service they
   belong to, and a local service keeps its data in the folder izumi gives it.
7. **An honest listing.** The name and description say what it does and what it needs (an account, a
   key, a subscription). Adult content is marked `nsfw`.

## Submitting a plugin, a source or a pack

1. **Build and publish it in your own repository.** Follow [building a plugin](docs/building-a-plugin.md),
   [building a source](docs/building-a-source.md) or [building a pack](docs/building-a-pack.md).
2. **Install it from your own link.** In izumi, paste the raw link to your `plugin.json` under
   **Settings → Sources and store → Plugins**; for a source, paste the raw link to your `store.json` under
   **Settings → Store → Add store**; for a pack, open `izumi://pack?url=<link to pack.json>`. Then
   use it.
3. **Fork this repository and add a listing.** One folder per plugin, source or pack:

   ```
   plugins/<id>/listing.json
   sources/<id>/listing.json
   packs/<id>/listing.json
   ```

   ```json
   {
     "id": "example.my-plugin",
     "repo": "you/my-plugin",
     "branch": "main",
     "plugin": "plugin/plugin.json",
     "commit": "<the full SHA of the commit to list>"
   }
   ```

   [docs/listing.md](docs/listing.md) has every field of each kind.
4. **Build and test.** With Node.js 22.16 or newer:

   ```sh
   npm install
   npm run build   # checks your listing, records a source's signing key, regenerates store.json
   npm test
   ```

5. **Open a pull request** and fill in the template. CI runs the same checks plus a virus scan.

## Review

A maintainer reads the source at the listed commit, checks it against the rules above, installs it,
and tries it. Reviews are done by volunteers, so they take as long as they take; a small, clear
listing with a good description is quicker to review. Questions and requested changes go in the
pull request.

## Updates

After your listing is merged, you don't open pull requests for new versions. Every hour, an update
job looks for a newer commit, checks it the same way and scans it. For a plugin that is the newest
commit that changed its folder; for a source or pack, the newest commit on its branch.

- if it passes, the pin moves and izumi offers the new version the next time it checks the store;
- if it doesn't, the old pin stays, and an issue named `Update held: <owner>/<repo>` explains why.
  Push a fixed commit and the next run tries again.

Every commit on the followed branch can reach users within the hour, so follow a release branch if
you want to choose when a version ships. These need a pull request and a review instead: a plugin
asking for different permissions, a new signing key for a source, or a change to `repo`, `branch`,
`plugin`, `store`, `pack` or `themes`.

## izumi's own plugins

Plugins izumi maintains live in [`official/`](official/). They are listed like any other: a listing
in `plugins/` pins a commit of this repository, changes come by pull request, and the hourly job
checks and scans them before the pin moves.

## Repository layout

```
marketplace.json        which marketplace this is (forks change it)
store.json              the index izumi reads (generated)
plugins/<id>/listing.json
sources/<id>/listing.json
packs/<id>/listing.json
packs/<id>/pack.json    the pack izumi reads, pinned to this store (generated)
official/               plugins izumi maintains
docs/                   guides for authors and marketplace owners
scripts/lib.mjs         the checks
scripts/build.mjs       npm run build / npm test
scripts/update.mjs      the hourly update
scripts/pin-main.mjs    writes a plugin's main file hash into plugin.json
.github/                CI: validate pull requests, update pins, ClamAV setup
```

## Development

```sh
npm install
npm test                   # unit tests, then every listing at its pin
node scripts/build.mjs --scan   # also run ClamAV (needs clamscan on PATH)
```

`scripts/lib.mjs` mirrors the rules of izumi's plugin runtime (`src/lib/plugins/manifest.ts`),
package installer (`src-tauri/src/extension_package.rs`) and pack format (`src/lib/packs/format.ts`).
A change to any of them in izumi needs the same change here.

## Licence

The tooling and documentation are [MIT](LICENSE). Each plugin, source and pack keeps its own
licence, set in its own repository; listing it here doesn't transfer ownership.

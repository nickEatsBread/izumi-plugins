# Running your own marketplace

izumi isn't limited to its own stores. Anyone can publish a store, and users add it under
**Settings → Store → Add store** (or with an `izumi://store/add?url=<link>` link). Once added, its
plugins, themes and packs show up in the Store next to izumi's own. Nothing installs until the user
chooses it.

There are two ways to run one.

## A single store file

If you publish your own plugins, the `store.json` in your repository is already a store
([building a plugin](building-a-plugin.md#publishing-from-your-repository)). Share its raw link.

## A reviewed marketplace like this one

To list other people's plugins with the same pinning, checks and virus scans:

1. Fork this repository (or use it as a template).
2. Edit `marketplace.json`:
   - `repository` and `branch`: where your fork publishes `store.json`;
   - `id` and `name`: your store's identity. Names that start with "izumi" are reserved for izumi's
     own stores; izumi shows your store's web address instead of such a name.
3. Delete the listings you don't want to carry, then run `npm install` and `npm run build`.
4. Enable GitHub Actions in your fork. `Validate listings` runs on pull requests, and
   `Update pinned listings` moves pins every hour.
5. Share `https://raw.githubusercontent.com/<you>/<repo>/<branch>/store.json`.

Packs listed in your marketplace install from your store, just as they do here.

## Trust

izumi trusts a store on first use. A store can also sign its index: it declares
`"publicKey": "ed25519:<base64 of the raw 32-byte key>"` in `store.json` and publishes
`store.json.sig` next to it, an Ed25519 signature of `izumi-store-index-v1\n` followed by the file's
exact bytes. izumi's [`scripts/store/sign-store-index.mjs`](https://github.com/nickEatsBread/izumi/blob/main/scripts/store/sign-store-index.mjs)
creates the key and the signature. izumi pins the key on first use and refuses the store if a later
index is signed with a different one. Sign after every regeneration of `store.json`, and keep the
private key in a CI secret.

# Building an izumi plugin

An izumi plugin is a **source**: it finds titles, episodes and streams for izumi. It ships as a
signed `.izumi-ext` package that izumi installs from a store. This guide covers the package, the
two kinds of plugin, signing, and publishing a store from your own repository. Getting listed in
this repository comes after that; see the [README](../README.md#submitting-a-plugin-or-a-pack).

| Backend | What runs | Choose it when |
| --- | --- | --- |
| `izumi-js` | One JavaScript module, in izumi's sandboxed extension worker. One package for every platform. | The source only needs HTTP requests. |
| `izumi-service` | A native program izumi starts on the user's device. One package per platform. | You need a real runtime: a sign-in flow, a local proxy, protected playback, or a catalog of your own. |

Local services are desktop only (Windows, macOS, Linux and the Steam Deck).

## The package

A `.izumi-ext` file is a ZIP archive, at most 160 MB, holding exactly these five files at its root.
izumi refuses any other file (only macOS `__MACOSX/`, `.DS_Store` and `._*` entries are ignored).

| File | Contents |
| --- | --- |
| `manifest.json` | What the package is. |
| `compatibility.json` | The runtime it targets, and for a service the platform it was built for. |
| `extension.js`, `service` or `service.exe` | The code: `extension.js` for `izumi-js`, `service.exe` for a Windows service, `service` everywhere else. |
| `integrity.json` | The SHA-256 of the three files above. |
| `signature.json` | An Ed25519 signature over `integrity.json`. |

`manifest.json`:

```json
{
  "formatVersion": 1,
  "runtimeAbi": 1,
  "id": "example.my-source",
  "name": "My Source",
  "version": "1.0.0",
  "entry": "service",
  "execution": { "backend": "izumi-service", "status": "compatible" },
  "sources": [{ "id": "example.my-source", "name": "My Source", "language": "en", "baseUrl": "https://example.com" }]
}
```

- `id` is permanent. Use lowercase letters, digits, dots and hyphens (2-64 characters), for example
  `yourname.source-name`. The store entry, the listing folder and the package all use it.
- `version` is `major.minor.patch`. Every release gets a new one.
- `entry` is `extension.js`, `service` or `service.exe`, matching the backend and platform.

`compatibility.json` is `{ "runtime": "izumi-anime-extension-v1" }` for `izumi-js`, and for a
service `{ "runtime": "izumi-local-service-v1", "platform": "linux-x86_64" }` with one of
`windows-x86_64`, `windows-aarch64`, `linux-x86_64`, `linux-aarch64`, `macos-x86_64` or
`macos-aarch64`.

`integrity.json`:

```json
{
  "algorithm": "SHA-256",
  "files": {
    "manifest.json": "<lowercase hex SHA-256>",
    "compatibility.json": "<lowercase hex SHA-256>",
    "service": "<lowercase hex SHA-256>"
  }
}
```

### Signing

`signature.json` holds your public key and the signature of `integrity.json` in canonical form:
object keys sorted, no whitespace.

```json
{ "algorithm": "Ed25519", "signed": true, "publicKey": "-----BEGIN PUBLIC KEY-----\n…", "signature": "<base64>" }
```

With Node.js:

```js
import { createPrivateKey, createPublicKey, sign } from 'node:crypto'

const canonical = (value) => value === null || typeof value !== 'object'
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`

const privateKey = createPrivateKey(process.env.IZUMI_SIGNING_KEY) // an Ed25519 PKCS#8 PEM
const signature = {
  algorithm: 'Ed25519',
  signed: true,
  publicKey: createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }),
  signature: sign(null, Buffer.from(canonical(integrity)), privateKey).toString('base64'),
}
```

Create the key once (`openssl genpkey -algorithm ed25519`) and keep it for the life of the plugin,
in a CI secret rather than the repository. izumi refuses an update signed with a different key, and
this repository holds back any update whose key changed until a maintainer has reviewed it. If the
key is lost or leaked, open an issue here.

## A local service (`izumi-service`)

izumi starts your program when the source is first needed and stops it when izumi closes. It sets:

| Variable | Meaning |
| --- | --- |
| `IZUMI_EXTENSION_PORT` | The port to listen on. Listen on `127.0.0.1` only. |
| `IZUMI_EXTENSION_DATA_DIR` | A folder that belongs to your service. Keep sessions, tokens and caches here and nowhere else. |
| `IZUMI_EXTENSION_ID` | Your package id. |
| `IZUMI_PARENT_PID` | izumi's process id. Exit when that process is gone. |

Your service answers:

- **`GET /index.json`** (required): the source manifest. izumi waits until this returns JSON, then
  treats your service like any other source.

  ```json
  {
    "id": "example.my-source",
    "name": "My Source",
    "version": "1.0.0",
    "type": "onlinestream-provider",
    "lang": "en",
    "description": "What the source does and what it needs.",
    "icon": "https://example.com/icon.png",
    "main": "provider.js",
    "catalog": "/catalog/manifest.json"
  }
  ```

  `main` is the provider module izumi loads from your service (see
  [the provider module](#the-provider-module)). `catalog` is optional: the path of a Stremio-style
  addon manifest your service serves. izumi then offers your catalog as a screen of its own.
- **`GET` and `POST /__izumi/settings`** (optional): a settings form izumi draws natively, for
  sign-in and preferences. The document's shape is `ServiceSettingsDocument` in izumi's
  [`src/lib/extensions/manager.ts`](https://github.com/nickEatsBread/izumi/blob/main/src/lib/extensions/manager.ts):
  fields (`text`, `password`, `number`, `boolean`, `select`), current values, an optional notice,
  and `complete: true` once the source is ready to use (packs wait for it during setup). `POST`
  receives `{ "values": { … } }` and returns the updated document.
- **`POST /__izumi/shutdown`** (optional): izumi asks before it stops the process.

On Windows the program runs without a console window, and ends together with izumi.

Single-file runtimes work well: `bun build --compile --target=bun-linux-x64`, `deno compile`, Go,
or Rust. Build each platform's package with its own `compatibility.json`, and sign them all with
the same key.

## The provider module

The provider module is plain JavaScript (an ES module whose default export is the provider). It
runs in izumi's extension worker, where `fetch` goes through izumi. It is either:

- a **stream provider** (`"type": "onlinestream-provider"`), with `search(options)`,
  `findEpisodes(id)` and `findEpisodeServer(episode, server)`; or
- a **torrent provider** (`"type": "torrent"`), with `single(query)`, `batch(query)` and
  `movie(query)`, each returning results with at least a `title` and a 40-character `hash`.

The query and result types are in izumi's
[`src/lib/extensions/types.ts`](https://github.com/nickEatsBread/izumi/blob/main/src/lib/extensions/types.ts).
An `izumi-js` package ships this module as its `extension.js`; a service serves it at the path
`main` names.

## Publishing from your repository

Publish a store index in your repository, for example `izumi/store.json`, and the packages as
release assets. Users can add that store by link, and this repository reads the same file.

```json
{
  "app": "izumi",
  "kind": "store",
  "schemaVersion": 1,
  "id": "my-source",
  "name": "My Source",
  "entries": [
    {
      "kind": "source",
      "sourceType": "package",
      "backend": "izumi-service",
      "id": "example.my-source",
      "name": "My Source",
      "version": "1.0.0",
      "author": "Your name",
      "description": "What it does, and what it needs from the user (an account, a key).",
      "icon": "icon.png",
      "homepage": "https://github.com/you/my-source",
      "languages": ["en"],
      "content": ["anime"],
      "builds": {
        "linux-x86_64": { "url": "https://github.com/you/my-source/releases/download/v1.0.0/my-source-linux-x86_64.izumi-ext", "sha256": "…", "bytes": 41234567 },
        "windows-x86_64": { "url": "https://github.com/you/my-source/releases/download/v1.0.0/my-source-windows-x86_64.izumi-ext", "sha256": "…", "bytes": 42345678 }
      }
    }
  ]
}
```

- An `izumi-js` entry has `url`, `sha256` and `bytes` directly instead of `builds`.
- Relative links resolve against the store file. Raw GitHub links into your followed branch are
  pinned to the reviewed commit when this repository lists you.
- `sha256` and `bytes` must be exact. Generate the file with a script after building, never by hand.
- A store may also list themes (`"kind": "theme"`, the same fields as an
  [izumi-themes](https://github.com/nickEatsBread/izumi-themes) listing with `url`, `sha256` and `bytes`)
  for a pack to apply.

Try it before submitting: in izumi open **Settings → Store → Add store** and paste the raw link to
your `store.json` (or open `izumi://store/add?url=<link>`), then install your source from there.

## Before you submit

- [ ] The package holds exactly the five files, and `id` and `version` match the store entry.
- [ ] Every build is signed with the same key, and the key is kept out of the repository.
- [ ] A service listens on `127.0.0.1` only, keeps its data in `IZUMI_EXTENSION_DATA_DIR`, and exits
      when izumi does.
- [ ] Credentials go only to the service they belong to.
- [ ] The packages come from a build of the public source at the commit you list.
- [ ] You installed it from your own store link and played something.

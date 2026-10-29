# Building an izumi pack

A pack is one link that sets izumi up for a purpose: the sources and theme to install, the stores
they come from, native modules to fetch, a startup video and the setup steps that follow. izumi
shows everything a pack will do on a review screen before it applies anything, and removing the pack
removes what it added.

## `pack.json`

```json
{
  "app": "izumi",
  "kind": "pack",
  "schemaVersion": 1,
  "id": "example.my-pack",
  "name": "My Pack",
  "version": "1.0.0",
  "author": "Your name",
  "description": "What izumi will look like and do once this pack is set up.",
  "icon": "icon.png",
  "homepage": "https://github.com/you/my-source",
  "minAppVersion": "0.1.75",
  "stores": [{ "url": "store.json" }],
  "items": [
    { "ref": "source", "kind": "source", "from": { "store": "store.json", "id": "example.my-source" }, "screen": "default" },
    { "ref": "look", "kind": "theme", "from": { "store": "store.json", "id": "example.my-look" }, "apply": true }
  ],
  "startup": { "video": { "url": "intro.mp4", "sha256": "…", "bytes": 1234567 } },
  "setup": { "steps": [{ "item": "source", "step": "settings", "title": "Sign in" }] }
}
```

| Field | Rules |
| --- | --- |
| `id`, `version` | Like a plugin's: a permanent lowercase id, and `major.minor.patch`. |
| `name`, `description`, `author` | Text, or `{ "en": "…", "de": "…" }` with English as the fallback. Name up to 64 characters. |
| `icon`, `banner`, `homepage` | Optional https links (relative links resolve against `pack.json`). |
| `minAppVersion` | Optional. Older izumi versions say the pack needs an update. |
| `stores` | Stores to add, `[{ "url": … }]`. Item stores are added too, so this can stay short. |
| `items` | Up to 20. `kind` is `source` or `theme`; `from` names the store and the entry id. `apply: true` makes a theme the active one (one per pack). `screen: true` adds a source's own catalog screen, `"default"` also opens izumi on it (one per pack). |
| `modules` | Optional `[{ "id": … }]` of native modules izumi provides, fetched only on devices that need them. |
| `startup.video` | Optional, at most 16 MB, with its exact `sha256` and `bytes`. Plays when izumi starts. |
| `setup.steps` | Up to 8 `{ "item": "<ref>", "step": "settings", "title": … }`: izumi opens that source's settings after setup, for sign-in and similar. |

The file may be at most 64 KB.

Try it before submitting: open `izumi://pack?url=<raw link to pack.json>`, or paste the link under
**Add pack** in izumi's settings.

## When this repository lists your pack

The pack izumi reads is a copy this repository writes to `packs/<id>/pack.json` from your file at the
pinned commit:

- Stores that a plugin listing here pins become this repository's store, so the pack installs the
  reviewed, scanned copies and keeps updating through them. The izumi theme catalog
  (`https://raw.githubusercontent.com/nickEatsBread/izumi-themes/main/index.json`) stays as it is.
  Any other store is refused: list the plugin first.
- Each source or theme an item installs from this store must be in a listing here. A plugin listing
  names the themes it brings in `themes`.
- Raw GitHub links into your followed branch (the startup video, the icon) are pinned to the commit.

A pack and the plugin it installs usually live in one repository. Listings from the same repository
and branch move to a new commit together, so they never point at different versions.

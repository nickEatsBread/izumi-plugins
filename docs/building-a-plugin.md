# Building an izumi plugin

A plugin adds a feature to izumi. It runs in izumi's plugin sandbox, with no access to the user's
accounts, sources or files, and it can only do what the user allowed when they installed it. Users
find plugins under **Settings → Plugins** (a beta, off until they switch it on).

A plugin is two files in one folder of your repository:

```
plugin/
  plugin.json   what it is and what it may do
  main.js       its code: one JavaScript module
```

[Jump to a moment](../official/jump-to-moment/) is a complete example.

Sources (what finds titles and streams) are not plugins: see [building a source](building-a-source.md).

## `plugin.json`

```json
{
  "app": "izumi",
  "kind": "plugin",
  "schemaVersion": 1,
  "pluginApi": 1,
  "id": "example.my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "author": "Your name",
  "description": "What it does, and what it needs from the user.",
  "main": { "path": "main.js", "sha256": "written by scripts/pin-main.mjs" },
  "permissions": {
    "scopes": ["network", "player.events", "player.panel"],
    "network": { "domains": ["api.example.com"], "reason": "Sends your question to the example service, and nowhere else." }
  },
  "settings": [
    { "id": "apiKey", "type": "secret", "label": "API key", "description": "Stays on this device." }
  ],
  "panel": { "label": "My Plugin", "placeholder": "Ask something…" }
}
```

| Field | Rules |
| --- | --- |
| `id` | Permanent. Lowercase words joined by dots or hyphens, like `com.example.name`. |
| `version` | Three numbers, like `1.0.0`. |
| `name`, `author`, `description` | Up to 60, 80 and 400 characters. |
| `main` | `path`: a `.js` file next to `plugin.json`. `sha256`: its SHA-256, so izumi runs exactly that file. |
| `permissions.scopes` | What it may do (below). Ask only for what it needs. |
| `permissions.network` | Needed with `network`. `domains`: https hosts (`*.example.com` allowed). `fromSetting`: a `url` setting whose address the user types. `reason`: shown to the user before they install. |
| `settings` | Up to 40. `type` is `text`, `secret`, `toggle`, `select` (with `options`), `number` or `url`. A secret can't have a `default`. |
| `panel` | A panel in the player, with its button label and prompt. Needs `player.panel`. |

`plugin.json` may be at most 64 KB, and the main file at most 2 MB.

### Scopes

| Scope | What it allows |
| --- | --- |
| `network` | `izumi.fetch` to the listed domains, and to the address of the `fromSetting` setting. Only https, except that one address when it is on the user's own computer. Other local and private addresses are refused. |
| `player.events` | `izumi.player.status()`: what is playing, the position, the duration and whether it is paused. |
| `player.subtitles` | `izumi.player.subtitles()`: the selected text subtitle track as cues. |
| `player.control` | `izumi.player.seek(seconds)`. |
| `player.panel` | `izumi.ui.setPanel(state)`: a prompt, steps and result cards that izumi draws. |

Every plugin has its settings, 5 MB of storage and a log without asking.

## `main.js`

The main file is an ES module whose default export has an `activate` function. izumi calls it with
the `izumi` object, the plugin's only way to reach anything:

```js
export default {
  async activate(izumi) {
    izumi.on('prompt', async ({ text }) => {
      const status = await izumi.player.status()
      izumi.log('asked about', status.title, text)
    })
  },
}
```

| Call | Returns |
| --- | --- |
| `izumi.settings.get()` | The setting values, secrets included. |
| `izumi.storage.get(key)`, `.set(key, value)`, `.delete(key)` | The plugin's own storage. |
| `izumi.fetch(url, { method, headers, body })` | `GET` or `POST` only. `{ status, ok, headers, text(), json() }`. |
| `izumi.player.status()` | `{ open: false }`, or `{ open, title, episode, anilistId, position, duration, paused }`. |
| `izumi.player.subtitles()` | `{ available, track, cues: [{ start, end, text }], tracks }`, or `{ available: false, reason }`. The cues are shifted by the user's subtitle delay. |
| `izumi.player.seek(seconds)` | Seeks the player. |
| `izumi.ui.setPanel({ activity, turns })` | Draws the player panel. A turn is `{ id, question, steps, text, seconds }`; a step is `{ label, state, icon, cards }`; a card is `{ id, title, subtitle, meta, quote, image: 'poster', icon }`. |
| `izumi.ui.notice(text)` | A short notice in the player. |
| `izumi.log(...parts)` | A line in the plugin's log (**Settings → Plugins → Log**). |
| `izumi.on(name, handler)` | Panel events: `prompt` (`{ text }`), `select` (`{ id }` of a card), `stop` and `reset`. |

The plugin runs in a Worker inside a sandboxed frame. `fetch`, `XMLHttpRequest`, `WebSocket` and
`EventSource` are removed, and the frame's content security policy blocks every other connection.
izumi stops a plugin that stops answering. Panels carry data only: izumi draws them, and the only
image is the playing title's cover.

## Pinning the main file

After every change to the main file, write its hash into `plugin.json`:

```sh
node scripts/pin-main.mjs path/to/plugin
```

`scripts/pin-main.mjs` is in this repository; copy it into yours if you like. Keep the files with LF
line endings (`* text=auto eol=lf` in `.gitattributes`), or a Windows checkout changes the hash.

## Trying it

In izumi, open **Settings → Plugins**, switch plugins on, and either pick `plugin.json` and its main
file from disk, or paste the raw link to your `plugin.json`. izumi shows what it asks for before it
installs.

## Getting listed

Add `plugins/<id>/listing.json` pointing at your repository, the path of your `plugin.json` and the
commit to list ([listing](listing.md)), then follow [Submitting](../README.md#submitting-a-plugin-a-source-or-a-pack).
After that, every commit that changes your plugin's folder is checked, scanned and listed within the
hour, unless it asks for different permissions: that needs a pull request.

## Before you submit

- [ ] It asks only for the scopes and domains it uses, and the `reason` says where data goes.
- [ ] Secrets are `secret` settings, and go only to the service they belong to.
- [ ] `main.sha256` matches the main file (run `scripts/pin-main.mjs`).
- [ ] The repository is public and has a licence.
- [ ] You installed it in izumi from your own `plugin.json` link and used it.

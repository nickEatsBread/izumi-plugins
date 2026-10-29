// The checks behind every listing in this repository. Pure apart from the `io` object the callers
// pass in (downloads and the scan folder), so the tests run them offline on fixtures.
//
// A listing pins one commit of its author's repository. Everything izumi installs through a listing
// is read at that commit: the author's store index or pack, and every file they name, which must
// match the size and SHA-256 written next to it. `build.mjs` checks the pins on disk; `update.mjs`
// moves a pin to a newer commit once that commit passes the same checks and the virus scan.
import { createHash, createPublicKey, verify } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { unzipSync } from 'fflate'

// Which marketplace this is. A fork edits marketplace.json and publishes its own store.
export const MARKETPLACE = JSON.parse(readFileSync(new URL('../marketplace.json', import.meta.url), 'utf8'))
export const BASE_URL = `https://raw.githubusercontent.com/${MARKETPLACE.repository}/${MARKETPLACE.branch}/`
export const STORE_URL = `${BASE_URL}store.json`
/** izumi's theme catalog. Packs may install themes from it as they are. */
export const THEME_CATALOG_URL = 'https://raw.githubusercontent.com/nickEatsBread/izumi-themes/main/index.json'
export const PLATFORMS = ['windows-x86_64', 'windows-aarch64', 'linux-x86_64', 'linux-aarch64', 'macos-x86_64', 'macos-aarch64']
export const LIMITS = { store: 2_000_000, package: 160 * 1024 * 1024, theme: 512_000, pack: 64_000, video: 16 << 20 }

// What izumi's package installer (src-tauri/src/extension_package.rs in the client) requires of
// each backend. Keep these in step with it.
const BACKENDS = {
  'izumi-js': { entry: () => 'extension.js', runtime: 'izumi-anime-extension-v1' },
  'izumi-service': { entry: (platform) => (platform.startsWith('windows-') ? 'service.exe' : 'service'), runtime: 'izumi-local-service-v1' },
}
const ID = /^[a-z0-9][a-z0-9.-]{1,63}$/
const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/
const BRANCH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/
const PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\.json$/
const COMMIT = /^[a-f0-9]{40}$/
const SHA256 = /^[a-f0-9]{64}$/
const VERSION = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/
const LISTING_KEYS = {
  plugins: ['id', 'repo', 'branch', 'store', 'commit', 'signingKey', 'themes', 'updatedAt'],
  packs: ['id', 'repo', 'branch', 'pack', 'commit', 'updatedAt'],
}

export function need(condition, message) {
  if (!condition) throw new Error(message)
}

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
export const rawUrl = (repo, ref, path) => `https://raw.githubusercontent.com/${repo}/${ref}/${path}`
const safePath = (value, pattern) => typeof value === 'string' && pattern.test(value) && !value.split('/').some((part) => part === '.' || part === '..')
const text = (value, max) => (typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : undefined)
const words = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item && item.length <= 32).slice(0, 24) : undefined)
/** A pack's strings may be `{lang: text}`; the store shows the English one. */
const localized = (value, max) => text(value && typeof value === 'object' && !Array.isArray(value) ? value.en : value, max)
/** Without undefined fields, so the generated JSON stays the same from run to run. */
const compact = (object) => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined))

/** The JSON izumi signs: object keys sorted, no whitespace (`canonical_json` in the client). */
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}

export function checkListing(kind, listing, folder, where = `${kind}/${folder}/listing.json`) {
  const fail = (message) => { throw new Error(`${where}: ${message}`) }
  if (!listing || typeof listing !== 'object' || Array.isArray(listing)) fail('must be a JSON object')
  for (const key of Object.keys(listing)) if (!LISTING_KEYS[kind].includes(key)) fail(`unknown field "${key}"`)
  if (listing.id !== folder || !ID.test(folder)) fail('id must match the folder name: 2-64 lowercase letters, digits, dots or hyphens')
  if (!REPO.test(listing.repo ?? '')) fail('repo must be "owner/name" of a public GitHub repository')
  const branch = listing.branch ?? 'main'
  if (!safePath(branch, BRANCH)) fail('branch is invalid')
  if (!safePath(kind === 'plugins' ? listing.store : listing.pack, PATH)) {
    fail(`${kind === 'plugins' ? 'store' : 'pack'} must be the path of a .json file in the repository`)
  }
  if (!COMMIT.test(listing.commit ?? '')) fail('commit must be a full 40-character commit SHA')
  if (listing.signingKey !== undefined && !SHA256.test(listing.signingKey)) fail('signingKey must be a 64-character hex fingerprint')
  if (listing.themes !== undefined && !(Array.isArray(listing.themes) && listing.themes.length <= 8 && listing.themes.every((id) => typeof id === 'string' && ID.test(id)))) {
    fail('themes must be a list of theme ids')
  }
  if (listing.updatedAt !== undefined && (typeof listing.updatedAt !== 'string' || Number.isNaN(Date.parse(listing.updatedAt)))) fail('updatedAt must be an ISO date')
  return { ...listing, branch }
}

/** `plugins/<id>/listing.json` and `packs/<id>/listing.json`, checked. Throws on the first bad one. */
export function readListings(root) {
  const out = { plugins: [], packs: [] }
  for (const kind of ['plugins', 'packs']) {
    let folders = []
    try {
      folders = readdirSync(join(root, kind), { withFileTypes: true }).filter((item) => item.isDirectory()).map((item) => item.name).sort()
    } catch {
      continue
    }
    for (const folder of folders) {
      const where = `${kind}/${folder}/listing.json`
      let listing
      try {
        listing = JSON.parse(readFileSync(join(root, kind, folder, 'listing.json'), 'utf8'))
      } catch (error) {
        throw new Error(`${where}: ${error.code === 'ENOENT' ? 'missing' : 'not valid JSON'}`)
      }
      out[kind].push(checkListing(kind, listing, folder, where))
    }
  }
  return out
}

export function writeListing(root, kind, listing) {
  const ordered = Object.fromEntries(LISTING_KEYS[kind].filter((key) => listing[key] !== undefined).map((key) => [key, listing[key]]))
  writeFileSync(join(root, kind, listing.id, 'listing.json'), `${JSON.stringify(ordered, null, 2)}\n`)
}

/** An absolute https link. A raw GitHub link into the listed repository's branch is pinned to the
 *  listing's commit, so what was checked is what izumi downloads. */
export function pinUrl(value, base, listing) {
  if (value === undefined) return undefined
  need(typeof value === 'string' && value.length <= 2048, `invalid link: ${value}`)
  const url = new URL(value, base)
  need(url.protocol === 'https:' && !url.username && !url.password, `links must be https: ${url.href}`)
  const prefix = `/${listing.repo}/`
  if (url.hostname === 'raw.githubusercontent.com' && url.pathname.toLowerCase().startsWith(prefix.toLowerCase())) {
    const rest = url.pathname.slice(prefix.length)
    const ref = [`${listing.branch}/`, `refs/heads/${listing.branch}/`].find((candidate) => rest.startsWith(candidate))
    if (ref) url.pathname = `${prefix}${listing.commit}/${rest.slice(ref.length)}`
  }
  return url.href
}

const ignorable = (name) => name.endsWith('/') || name.startsWith('__MACOSX/') || /(^|\/)(\.DS_Store|\._[^/]*)$/.test(name)

/** Checks one `.izumi-ext` the way izumi's installer does and returns its signer's fingerprint
 *  (hex SHA-256 of the raw Ed25519 key, the fingerprint izumi shows). */
export function checkPackage(bytes, expect) {
  let files
  try {
    files = unzipSync(new Uint8Array(bytes))
  } catch {
    throw new Error('is not a ZIP archive')
  }
  const backend = BACKENDS[expect.backend]
  const entry = backend.entry(expect.platform)
  const required = ['compatibility.json', entry, 'integrity.json', 'manifest.json', 'signature.json']
  const names = Object.keys(files).filter((name) => !ignorable(name))
  need(names.length === required.length && required.every((name) => names.includes(name)), `must contain exactly ${required.join(', ')}`)
  const json = (name) => {
    try {
      return JSON.parse(Buffer.from(files[name]).toString('utf8'))
    } catch {
      throw new Error(`${name} is not valid JSON`)
    }
  }
  const [manifest, compatibility, integrity, signature] = ['manifest.json', 'compatibility.json', 'integrity.json', 'signature.json'].map(json)
  need(manifest.formatVersion === 1 && manifest.runtimeAbi === 1, 'manifest.json must have formatVersion 1 and runtimeAbi 1')
  need(manifest.execution?.backend === expect.backend && manifest.execution?.status === 'compatible', `manifest.json must declare the ${expect.backend} backend as compatible`)
  need(manifest.entry === entry, `manifest.json entry must be ${entry}`)
  need(manifest.id === expect.id, `manifest.json id is "${manifest.id}", the listing's "${expect.id}"`)
  need(manifest.version === expect.version, `manifest.json version is "${manifest.version}", the listing's "${expect.version}"`)
  need(Array.isArray(manifest.sources) && manifest.sources.length > 0 && manifest.sources.every((source) => typeof source?.id === 'string' && source.id), 'manifest.json must name at least one source with an id')
  need(compatibility.runtime === backend.runtime, `compatibility.json runtime must be ${backend.runtime}`)
  if (expect.backend === 'izumi-service') need(compatibility.platform === expect.platform, `is built for ${compatibility.platform}, listed for ${expect.platform}`)
  const hashed = ['manifest.json', 'compatibility.json', entry]
  need(integrity.algorithm === 'SHA-256' && integrity.files && typeof integrity.files === 'object' && Object.keys(integrity.files).length === hashed.length,
    `integrity.json must list the SHA-256 of exactly ${hashed.join(', ')}`)
  for (const name of hashed) need(integrity.files[name] === sha256(files[name]), `integrity check failed for ${name}`)
  need(signature.signed === true && signature.algorithm === 'Ed25519', 'must be signed with Ed25519 (see docs/building-a-plugin.md)')
  let key
  try {
    key = createPublicKey(String(signature.publicKey))
  } catch {
    throw new Error('signature.json has an invalid public key')
  }
  need(key.asymmetricKeyType === 'ed25519', 'signature.json must carry an Ed25519 public key')
  need(verify(null, Buffer.from(canonical(integrity)), key, Buffer.from(String(signature.signature), 'base64')), 'signature verification failed')
  return sha256(Buffer.from(key.export({ format: 'jwk' }).x, 'base64url'))
}

function fileRef(raw, link, limit, where) {
  need(raw && typeof raw === 'object', `${where} names no file`)
  const url = link(raw.url)
  need(url, `${where} has no url`)
  need(typeof raw.sha256 === 'string' && SHA256.test(raw.sha256.toLowerCase()), `${where} has no valid sha256`)
  need(Number.isSafeInteger(raw.bytes) && raw.bytes > 0 && raw.bytes <= limit, `${where} needs its size in bytes, at most ${limit}`)
  return { url, sha256: raw.sha256.toLowerCase(), bytes: raw.bytes }
}

async function download(io, file, limit, name) {
  const bytes = await io.bytes(file.url, limit)
  need(bytes.length === file.bytes, `${name} is ${bytes.length} bytes, listed as ${file.bytes}`)
  need(sha256(bytes) === file.sha256, `${name} does not match its listed sha256`)
  io.keep?.(name, bytes)
  return bytes
}

/** The entries one plugin listing puts in this store: its source, and the themes it names. With
 *  `verify`, every file is downloaded and checked, and the signer must be the pinned one. */
export async function resolvePlugin(listing, io, { verify = true } = {}) {
  const storeUrl = rawUrl(listing.repo, listing.commit, listing.store)
  const doc = await io.json(storeUrl, LIMITS.store)
  need(doc?.app === 'izumi' && doc.kind === 'store' && doc.schemaVersion === 1 && Array.isArray(doc.entries), `${listing.store} is not an izumi store index (schemaVersion 1)`)
  const link = (value) => pinUrl(value, storeUrl, listing)
  const repoPage = `https://github.com/${listing.repo}`
  const listed = (kind, id) => doc.entries.find((entry) => entry?.kind === kind && entry.id === id)

  const source = listed('source', listing.id)
  need(source, `${listing.store} does not list the source "${listing.id}"`)
  need(source.sourceType === 'package' && Object.hasOwn(BACKENDS, source.backend), 'only packaged sources (backend izumi-js or izumi-service) are listed here')
  const name = text(source.name, 64)
  const description = text(source.description, 600)
  need(name && description, 'the source needs a name (up to 64 characters) and a description (up to 600)')
  need(VERSION.test(source.version ?? ''), 'the source version must look like 1.2.3')
  let files
  if (source.backend === 'izumi-service') {
    const builds = source.builds
    need(builds && typeof builds === 'object' && !Array.isArray(builds) && Object.keys(builds).length, 'a local service lists one build per platform under "builds"')
    for (const platform of Object.keys(builds)) need(PLATFORMS.includes(platform), `unknown platform "${platform}" (use ${PLATFORMS.join(', ')})`)
    files = Object.fromEntries(Object.keys(builds).sort().map((platform) => [platform, fileRef(builds[platform], link, LIMITS.package, `build ${platform}`)]))
  } else {
    need(source.builds === undefined, 'an izumi-js package is one file for every platform: url, sha256 and bytes, without builds')
    files = { any: fileRef(source, link, LIMITS.package, 'the package') }
  }
  const updatedAt = listing.updatedAt
  const entries = [compact({
    kind: 'source', sourceType: 'package', backend: source.backend, id: listing.id, name, version: source.version,
    author: text(source.author, 80), description, icon: link(source.icon), homepage: link(source.homepage) ?? repoPage,
    languages: words(source.languages), content: words(source.content),
    nsfw: source.nsfw === true ? true : undefined, requiresDebrid: source.requiresDebrid === true ? true : undefined, updatedAt,
    ...(source.backend === 'izumi-service' ? { builds: files } : files.any),
  })]

  let signingKey = listing.signingKey
  if (verify) {
    const signers = new Set()
    for (const [platform, file] of Object.entries(files)) {
      const fileName = `${listing.id}/${platform === 'any' ? 'package' : platform}.izumi-ext`
      const bytes = await download(io, file, LIMITS.package, fileName)
      try {
        signers.add(checkPackage(bytes, { id: listing.id, version: source.version, backend: source.backend, platform }))
      } catch (error) {
        throw new Error(`${fileName} ${error.message}`)
      }
    }
    need(signers.size === 1, 'every build must be signed with the same key')
    const [signer] = signers
    need(!listing.signingKey || listing.signingKey === signer,
      `the packages are signed with ${signer}, not the pinned key ${listing.signingKey}; a maintainer has to review a key change`)
    signingKey = signer
  }

  for (const id of listing.themes ?? []) {
    const theme = listed('theme', id)
    need(theme, `${listing.store} does not list the theme "${id}"`)
    need(text(theme.name, 48) && VERSION.test(theme.version ?? ''), `theme ${id} needs a name and a version like 1.2.3`)
    const file = fileRef(theme, link, LIMITS.theme, `theme ${id}`)
    entries.push(compact({
      kind: 'theme', id, name: theme.name.trim(), version: theme.version, author: text(theme.author, 80), description: text(theme.description, 600),
      themeApi: theme.themeApi, tags: words(theme.tags) ?? [], platforms: words(theme.platforms), ...file,
      preview: link(theme.preview), homepage: link(theme.homepage) ?? repoPage, updatedAt,
    }))
    if (verify) {
      const bytes = await download(io, file, LIMITS.theme, `${listing.id}/theme-${id}.json`)
      let pkg
      try {
        pkg = JSON.parse(Buffer.from(bytes).toString('utf8'))
      } catch {
        throw new Error(`theme ${id} is not valid JSON`)
      }
      need(pkg?.app === 'izumi' && pkg.kind === 'theme-package' && pkg.id === id && pkg.version === theme.version && pkg.themeApi === theme.themeApi,
        `theme ${id} does not match its listing (app, kind, id, version and themeApi)`)
    }
  }
  return { entries, signingKey }
}

/** A pack listing: the pack as izumi will read it from this repository, and its store entry. Every
 *  store the pack installs from becomes this store (when a plugin listing here pins it) or stays the
 *  theme catalog, so a listed pack only installs entries that were checked and scanned here. */
export async function resolvePack(listing, io, { verify = true, listed, plugins }) {
  const packUrl = rawUrl(listing.repo, listing.commit, listing.pack)
  const doc = await io.json(packUrl, LIMITS.pack)
  need(doc?.app === 'izumi' && doc.kind === 'pack' && doc.schemaVersion === 1, `${listing.pack} is not an izumi pack (schemaVersion 1)`)
  need(doc.id === listing.id, `${listing.pack} has the id "${doc.id}", the listing "${listing.id}"`)
  need(VERSION.test(doc.version ?? ''), 'the pack version must look like 1.2.3')
  const name = localized(doc.name, 64)
  const description = localized(doc.description, 600)
  need(name && description, 'the pack needs a name and a description')
  const link = (value) => pinUrl(value, packUrl, listing)
  const storeOf = (value, where) => {
    need(typeof value === 'string', `${where} names no store`)
    const url = new URL(value, packUrl)
    if (url.href === THEME_CATALOG_URL) return url.href
    const owner = plugins.find((plugin) => url.hostname === 'raw.githubusercontent.com'
      && url.pathname.toLowerCase().startsWith(`/${plugin.repo}/`.toLowerCase()) && url.pathname.endsWith(`/${plugin.store}`))
    need(owner, `${where} installs from ${url.href}, which no plugin listing here pins. List that plugin first.`)
    return STORE_URL
  }

  const pinned = structuredClone(doc)
  if (doc.stores !== undefined) {
    need(Array.isArray(doc.stores), 'stores must be a list')
    pinned.stores = [...new Set(doc.stores.map((store, index) => storeOf(store?.url, `store ${index + 1}`)))].map((url) => ({ url }))
  }
  need(Array.isArray(doc.items) && doc.items.length, 'a pack installs at least one item')
  pinned.items = doc.items.map((item, index) => {
    const store = storeOf(item?.from?.store, `item ${index + 1}`)
    if (store === STORE_URL) {
      need(listed.has(`${item.kind}:${item.from.id}`), `item ${index + 1} installs the ${item.kind} "${item.from.id}", which no listing here includes`)
    }
    return { ...item, from: { ...item.from, store } }
  })
  for (const key of ['icon', 'banner', 'homepage']) if (typeof doc[key] === 'string') pinned[key] = link(doc[key])
  if (doc.startup?.video !== undefined) {
    const file = fileRef(doc.startup.video, link, LIMITS.video, 'the startup video')
    pinned.startup = { ...doc.startup, video: file }
    if (verify) await download(io, file, LIMITS.video, `${listing.id}/startup-video`)
  }
  const out = `${JSON.stringify(pinned, null, 2)}\n`
  need(Buffer.byteLength(out) <= LIMITS.pack, 'the pack is larger than 64 KB')
  return {
    text: out,
    entry: compact({
      kind: 'pack', id: listing.id, name, version: doc.version, author: localized(doc.author, 80), description,
      icon: pinned.icon, homepage: pinned.homepage ?? `https://github.com/${listing.repo}`,
      url: `${BASE_URL}packs/${listing.id}/pack.json`, sha256: sha256(out), bytes: Buffer.byteLength(out), updatedAt: listing.updatedAt,
    }),
  }
}

/** Every listing resolved into `store.json` and the pinned `packs/<id>/pack.json` files. Problems are
 *  collected per listing rather than stopping at the first. `verify` picks the listings whose files
 *  are downloaded and checked; the rest are only read at their pinned commit. */
export async function buildStore(listings, io, { verify = () => true } = {}) {
  const entries = []
  const files = {}
  const keys = {}
  const errors = []
  const keyOf = (entry) => `${entry.kind}:${entry.id}`
  for (const listing of listings.plugins) {
    try {
      const result = await resolvePlugin(listing, io, { verify: verify(listing) })
      for (const entry of result.entries) need(!entries.some((other) => keyOf(other) === keyOf(entry)), `the ${entry.kind} "${entry.id}" is already listed`)
      entries.push(...result.entries)
      keys[listing.id] = result.signingKey
    } catch (error) {
      errors.push({ listing, message: `plugins/${listing.id}: ${error.message}` })
    }
  }
  const listed = new Set(entries.map(keyOf))
  for (const listing of listings.packs) {
    try {
      const { entry, text: pack } = await resolvePack(listing, io, { verify: verify(listing), listed, plugins: listings.plugins })
      entries.push(entry)
      files[`packs/${listing.id}/pack.json`] = pack
    } catch (error) {
      errors.push({ listing, message: `packs/${listing.id}: ${error.message}` })
    }
  }
  const store = {
    app: 'izumi', kind: 'store', schemaVersion: 1, id: MARKETPLACE.id, name: MARKETPLACE.name,
    description: MARKETPLACE.description, homepage: `https://github.com/${MARKETPLACE.repository}`, entries,
  }
  files['store.json'] = `${JSON.stringify(store, null, 2)}\n`
  return { files, keys, errors }
}

/** Moves each listing's pin to the newest commit of its branch, once that commit passes every check
 *  and the scan. Listings from one repository and branch move together, so a pack and the plugin it
 *  installs never point at different commits; a commit that fails keeps the old pin. Returns the
 *  listings to write, the generated files (when anything moved) and a report of what moved or not. */
export async function updatePins(current, io) {
  const groupOf = (listing) => `${listing.repo.toLowerCase()}@${listing.branch}`
  const groups = new Map()
  for (const [kind, list] of Object.entries(current)) {
    for (const listing of list) {
      const key = groupOf(listing)
      if (!groups.has(key)) groups.set(key, { repo: listing.repo, branch: listing.branch, members: [] })
      groups.get(key).members.push({ kind, listing })
    }
  }
  const moved = new Map()
  const withMoves = (trial) => {
    const apply = (listing) => {
      const head = trial?.key === groupOf(listing) ? trial.head : moved.get(groupOf(listing))
      return head ? { ...listing, commit: head.sha, ...(head.date ? { updatedAt: head.date } : {}) } : listing
    }
    return { plugins: current.plugins.map(apply), packs: current.packs.map(apply) }
  }
  const report = { updated: [], held: [] }

  // The pinned state must build first, or a held update could not be told apart from a listing
  // that was already broken.
  const baseline = await buildStore(current, io, { verify: () => false })
  need(!baseline.errors.length, `the pinned listings do not build:\n${baseline.errors.map((error) => error.message).join('\n')}`)

  for (const [key, group] of groups) {
    let head
    try {
      head = await io.head(group.repo, group.branch)
    } catch (error) {
      report.held.push({ repo: group.repo, branch: group.branch, errors: [error.message] })
      continue
    }
    if (group.members.every(({ listing }) => listing.commit === head.sha)) continue
    const errors = group.members
      .filter(({ kind, listing }) => kind === 'plugins' && !listing.signingKey)
      .map(({ listing }) => `plugins/${listing.id}: has no signingKey yet, so a maintainer has to review it first`)
    if (!errors.length) {
      // Only this group's files are downloaded and scanned; the rest are read at their pins, so a
      // pack elsewhere that this move would break still holds it back.
      const trial = await buildStore(withMoves({ key, head }), io, { verify: (listing) => groupOf(listing) === key })
      errors.push(...trial.errors.map((error) => error.message))
      try {
        io.scan?.()
      } catch (error) {
        errors.push(error.message)
      }
    }
    const ids = group.members.map(({ kind, listing }) => `${kind}/${listing.id}`)
    if (errors.length) report.held.push({ repo: group.repo, branch: group.branch, commit: head.sha, ids, errors })
    else {
      moved.set(key, head)
      report.updated.push({ repo: group.repo, branch: group.branch, commit: head.sha, ids })
    }
  }
  if (!moved.size) return { listings: [], files: {}, report }
  const next = withMoves()
  const { files, errors } = await buildStore(next, io, { verify: () => false })
  need(!errors.length, `the moved listings do not build:\n${errors.map((error) => error.message).join('\n')}`)
  const listings = Object.entries(next).flatMap(([kind, list]) => list.filter((listing) => moved.has(groupOf(listing))).map((listing) => ({ kind, listing })))
  return { listings, files, report }
}

/** ClamAV over a folder. Exit 1 means something was flagged; anything but 0 or 1 is a failed scan,
 *  never a pass. Files over the size limits are flagged too, instead of being skipped. */
export function clamscan(folder, run = spawnSync) {
  const database = process.env.CLAMAV_DB ? [`--database=${process.env.CLAMAV_DB}`] : []
  const result = run('clamscan', ['--recursive', '--infected', '--no-summary', '--max-filesize=170M', '--max-scansize=600M', '--alert-exceeds-max=yes', ...database, folder], { encoding: 'utf8' })
  if (result.error) throw new Error(`clamscan could not run (${result.error.message}); install ClamAV, or leave out --scan`)
  if (result.status === 1) {
    throw new Error(`the virus scan flagged ${String(result.stdout).trim().split('\n').map((line) => line.replace(folder, '').replace(/^[\\/]\d+-/, '')).join('; ')}`)
  }
  need(result.status === 0, `the virus scan failed: ${String(result.stderr || result.stdout).trim()}`)
}

/** Size-capped downloads, the GitHub lookup of a branch's newest commit and, with `scan`, a folder
 *  that keeps every checked file until the next `scan()`. */
export function createIo({ token, scan = false } = {}) {
  const folder = scan ? mkdtempSync(join(tmpdir(), 'izumi-plugins-')) : null
  let count = 0
  async function bytes(url, limit) {
    const response = await fetch(url, { headers: { 'User-Agent': 'izumi-plugins-ci' }, signal: AbortSignal.timeout(300_000) })
    need(response.ok, `HTTP ${response.status} for ${url}`)
    need(!(Number(response.headers.get('content-length')) > limit), `${url} is larger than ${limit} bytes`)
    const chunks = []
    let size = 0
    for await (const chunk of response.body) {
      size += chunk.length
      need(size <= limit, `${url} is larger than ${limit} bytes`)
      chunks.push(chunk)
    }
    return Buffer.concat(chunks)
  }
  return {
    bytes,
    async json(url, limit) {
      const raw = await bytes(url, limit)
      try {
        return JSON.parse(raw.toString('utf8'))
      } catch {
        throw new Error(`${url} is not valid JSON`)
      }
    },
    async head(repo, branch) {
      const response = await fetch(`https://api.github.com/repos/${repo}/commits/${branch}`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'izumi-plugins-ci', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        signal: AbortSignal.timeout(30_000),
      })
      need(response.ok, `GitHub answered HTTP ${response.status} for ${repo}@${branch}`)
      const body = await response.json()
      need(COMMIT.test(body?.sha ?? ''), `GitHub returned no commit for ${repo}@${branch}`)
      return { sha: body.sha, date: body.commit?.committer?.date }
    },
    keep: folder ? (name, data) => writeFileSync(join(folder, `${++count}-${name.replace(/[^A-Za-z0-9._-]/g, '_')}`), data) : undefined,
    /** Scans everything kept since the last scan, then empties the folder. Without `scan`, nothing. */
    scan() {
      if (!folder) return
      try {
        clamscan(folder)
      } finally {
        for (const name of readdirSync(folder)) rmSync(join(folder, name), { force: true })
      }
    },
    close() {
      if (folder) rmSync(folder, { recursive: true, force: true })
    },
  }
}

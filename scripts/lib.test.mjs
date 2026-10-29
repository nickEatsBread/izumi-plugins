import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { strToU8, zipSync } from 'fflate'
import { BASE_URL, STORE_URL, THEME_CATALOG_URL, buildStore, canonical, checkListing, clamscan, pinUrl, sha256, updatePins } from './lib.mjs'

const COMMIT = 'a'.repeat(40)
const RAW = 'https://raw.githubusercontent.com/someone/example-source/main/izumi/'
const PINNED = `https://raw.githubusercontent.com/someone/example-source/${COMMIT}/izumi/`
const RELEASE = `https://github.com/someone/example-source/releases/download/${COMMIT.slice(0, 7)}/`
const keyA = generateKeyPairSync('ed25519')
const keyB = generateKeyPairSync('ed25519')
const fingerprint = (key) => createHash('sha256').update(Buffer.from(key.publicKey.export({ format: 'jwk' }).x, 'base64url')).digest('hex')

function makePackage({ key = keyA, platform = 'linux-x86_64', signed = true, extra } = {}) {
  const entry = platform.startsWith('windows-') ? 'service.exe' : 'service'
  const files = {
    'manifest.json': strToU8(JSON.stringify({
      formatVersion: 1, runtimeAbi: 1, id: 'example.source', name: 'Example', version: '1.0.0', entry,
      execution: { backend: 'izumi-service', status: 'compatible' }, sources: [{ id: 'example.source', name: 'Example' }],
    })),
    'compatibility.json': strToU8(JSON.stringify({ runtime: 'izumi-local-service-v1', platform })),
    [entry]: strToU8('not really a binary'),
  }
  const integrity = { algorithm: 'SHA-256', files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, sha256(bytes)])) }
  files['integrity.json'] = strToU8(JSON.stringify(integrity))
  files['signature.json'] = strToU8(JSON.stringify(signed
    ? {
        algorithm: 'Ed25519', signed: true, publicKey: key.publicKey.export({ type: 'spki', format: 'pem' }),
        signature: sign(null, Buffer.from(canonical(integrity)), key.privateKey).toString('base64'),
      }
    : { algorithm: 'none', signed: false }))
  if (extra) files[extra] = strToU8('#!/bin/sh')
  return Buffer.from(zipSync(files))
}

const file = (url, bytes) => ({ url, sha256: sha256(bytes), bytes: bytes.length })

function ioFor(urls, extra = {}) {
  const kept = []
  const bytes = async (url) => {
    if (!urls.has(url)) throw new Error(`HTTP 404 for ${url}`)
    return urls.get(url)
  }
  return { io: { bytes, json: async (url) => JSON.parse((await bytes(url)).toString('utf8')), keep: (name) => kept.push(name), ...extra }, kept }
}

/** An author repository at a commit: a store with a service and a theme, and a pack using both.
 *  Fixtures for two commits can share one `urls` map. */
function fixture({ commit = COMMIT, linux = {}, windows = {}, urls = new Map() } = {}) {
  const PINNED = `https://raw.githubusercontent.com/someone/example-source/${commit}/izumi/`
  const RELEASE = `https://github.com/someone/example-source/releases/download/${commit.slice(0, 7)}/`
  const linuxPackage = makePackage(linux)
  const windowsPackage = makePackage({ platform: 'windows-x86_64', ...windows })
  const theme = Buffer.from(JSON.stringify({ app: 'izumi', kind: 'theme-package', schemaVersion: 1, id: 'example.look', version: '1.0.0', themeApi: 7 }))
  const video = Buffer.from('a short video')
  const store = {
    app: 'izumi', kind: 'store', schemaVersion: 1, id: 'example', name: 'Example',
    entries: [
      {
        kind: 'source', sourceType: 'package', backend: 'izumi-service', id: 'example.source', name: 'Example', version: '1.0.0',
        description: 'An example source.', icon: 'icon.svg', languages: ['en'], content: ['anime'],
        builds: { 'linux-x86_64': file(`${RELEASE}linux.izumi-ext`, linuxPackage), 'windows-x86_64': file(`${RELEASE}windows.izumi-ext`, windowsPackage) },
      },
      { kind: 'theme', id: 'example.look', name: 'Look', version: '1.0.0', themeApi: 7, tags: ['Dark'], ...file(`${RAW}theme.json`, theme) },
    ],
  }
  const pack = {
    app: 'izumi', kind: 'pack', schemaVersion: 1, id: 'example.pack', name: { en: 'Example pack' }, version: '1.0.0',
    description: 'Sets izumi up with the example source.', icon: `${RAW}icon.svg`,
    stores: [{ url: `${RAW}store.json` }],
    items: [
      { ref: 'source', kind: 'source', from: { store: `${RAW}store.json`, id: 'example.source' }, screen: 'default' },
      { ref: 'look', kind: 'theme', from: { store: `${RAW}store.json`, id: 'example.look' }, apply: true },
    ],
    startup: { video: file(`${RAW}intro.mp4`, video) },
  }
  urls.set(`${PINNED}store.json`, Buffer.from(JSON.stringify(store)))
  urls.set(`${PINNED}pack.json`, Buffer.from(JSON.stringify(pack)))
  urls.set(`${RELEASE}linux.izumi-ext`, linuxPackage)
  urls.set(`${RELEASE}windows.izumi-ext`, windowsPackage)
  urls.set(`${PINNED}theme.json`, theme)
  urls.set(`${PINNED}intro.mp4`, video)
  return { ...ioFor(urls), urls }
}

const plugin = (extra = {}) => ({ id: 'example.source', repo: 'someone/example-source', branch: 'main', store: 'izumi/store.json', commit: COMMIT, themes: ['example.look'], ...extra })
const pack = (extra = {}) => ({ id: 'example.pack', repo: 'someone/example-source', branch: 'main', pack: 'izumi/pack.json', commit: COMMIT, ...extra })
const firstError = async (listings, options = {}) => (await buildStore(listings, fixture(options).io)).errors[0]?.message ?? ''

test('a plugin and a pack are listed pinned to the checked commit', async () => {
  const { io, kept } = fixture()
  const { files, keys, errors } = await buildStore({ plugins: [plugin()], packs: [pack()] }, io)
  assert.deepEqual(errors, [])
  assert.equal(keys['example.source'], fingerprint(keyA))
  const store = JSON.parse(files['store.json'])
  const [source, theme, listedPack] = store.entries
  assert.equal(source.icon, `${PINNED}icon.svg`)
  assert.equal(source.homepage, 'https://github.com/someone/example-source')
  assert.deepEqual(Object.keys(source.builds), ['linux-x86_64', 'windows-x86_64'])
  assert.equal(theme.url, `${PINNED}theme.json`)
  assert.equal(listedPack.url, `${BASE_URL}packs/example.pack/pack.json`)
  assert.equal(listedPack.name, 'Example pack')
  const packText = files['packs/example.pack/pack.json']
  assert.equal(listedPack.sha256, sha256(packText))
  const pinnedPack = JSON.parse(packText)
  assert.deepEqual(pinnedPack.stores, [{ url: STORE_URL }])
  assert.ok(pinnedPack.items.every((item) => item.from.store === STORE_URL))
  assert.equal(pinnedPack.startup.video.url, `${PINNED}intro.mp4`)
  assert.equal(pinnedPack.icon, `${PINNED}icon.svg`)
  assert.equal(kept.length, 4, 'two packages, the theme and the video go to the virus scan')
})

test('a file that differs from its listed hash is refused', async () => {
  const { io, urls } = fixture()
  urls.set(`${RELEASE}linux.izumi-ext`, makePackage({ extra: 'payload.sh' }))
  const { errors } = await buildStore({ plugins: [plugin()], packs: [] }, io)
  assert.match(errors[0].message, /linux-x86_64\.izumi-ext is \d+ bytes|does not match its listed sha256/)
})

test('packages must be what izumi installs, signed by the pinned key', async () => {
  assert.match(await firstError({ plugins: [plugin()], packs: [] }, { linux: { signed: false } }), /must be signed/)
  assert.match(await firstError({ plugins: [plugin()], packs: [] }, { linux: { platform: 'linux-aarch64' } }), /built for linux-aarch64, listed for linux-x86_64/)
  assert.match(await firstError({ plugins: [plugin()], packs: [] }, { linux: { extra: 'run.sh' } }), /must contain exactly/)
  assert.match(await firstError({ plugins: [plugin()], packs: [] }, { windows: { key: keyB } }), /same key/)
  assert.match(await firstError({ plugins: [plugin({ signingKey: fingerprint(keyB) })], packs: [] }), /review a key change/)
})

test('a pack only installs what listings here pin', async () => {
  assert.match(await firstError({ plugins: [], packs: [pack()] }), /no plugin listing here pins/)
  assert.match(await firstError({ plugins: [plugin({ themes: [] })], packs: [pack()] }), /theme "example.look", which no listing here includes/)
})

test('a pack may keep installing from the theme catalog', async () => {
  const { io, urls } = fixture()
  const raw = JSON.parse(urls.get(`${PINNED}pack.json`).toString('utf8'))
  raw.items[1].from.store = THEME_CATALOG_URL
  urls.set(`${PINNED}pack.json`, Buffer.from(JSON.stringify(raw)))
  const { files, errors } = await buildStore({ plugins: [plugin({ themes: [] })], packs: [pack()] }, io)
  assert.deepEqual(errors, [])
  assert.equal(JSON.parse(files['packs/example.pack/pack.json']).items[1].from.store, THEME_CATALOG_URL)
})

test('links into the listed branch are pinned, other links are kept', () => {
  const listing = plugin()
  assert.equal(pinUrl('https://raw.githubusercontent.com/someone/example-source/refs/heads/main/a.png', PINNED, listing),
    `https://raw.githubusercontent.com/someone/example-source/${COMMIT}/a.png`)
  assert.equal(pinUrl('https://raw.githubusercontent.com/other/repo/main/a.png', PINNED, listing), 'https://raw.githubusercontent.com/other/repo/main/a.png')
  assert.throws(() => pinUrl('http://example.com/a.png', PINNED, listing), /https/)
})

test('listings are checked before anything is downloaded', () => {
  assert.equal(checkListing('plugins', plugin({ branch: undefined }), 'example.source').branch, 'main')
  assert.throws(() => checkListing('plugins', plugin(), 'other.folder'), /folder name/)
  assert.throws(() => checkListing('plugins', plugin({ commit: 'main' }), 'example.source'), /40-character/)
  assert.throws(() => checkListing('plugins', plugin({ store: '../x.json' }), 'example.source'), /path of a .json file/)
  assert.throws(() => checkListing('packs', { ...pack(), store: 'x.json' }, 'example.pack'), /unknown field "store"/)
})

test('the virus scan passes only on a clean exit', () => {
  const run = (status, stdout = '') => () => ({ status, stdout, stderr: '' })
  assert.doesNotThrow(() => clamscan('/scan', run(0)))
  assert.throws(() => clamscan('/scan', run(1, '/scan/3-example.source_linux.izumi-ext: Eicar-Test-Signature FOUND')),
    /flagged example.source_linux.izumi-ext: Eicar-Test-Signature FOUND/)
  assert.throws(() => clamscan('/scan', run(2)), /scan failed/)
  assert.throws(() => clamscan('/scan', () => ({ error: new Error('ENOENT') })), /could not run/)
})

test('a newer commit that passes moves the pins of its repository together', async () => {
  const NEXT = 'b'.repeat(40)
  const { urls } = fixture()
  fixture({ commit: NEXT, urls })
  const { io, kept } = ioFor(urls, { head: async () => ({ sha: NEXT, date: '2026-10-29T12:00:00Z' }) })
  const current = { plugins: [plugin({ signingKey: fingerprint(keyA) })], packs: [pack()] }
  const { listings, files, report } = await updatePins(current, io)
  assert.deepEqual(report.held, [])
  assert.deepEqual(report.updated.map((item) => item.ids), [['plugins/example.source', 'packs/example.pack']])
  assert.ok(listings.every(({ listing }) => listing.commit === NEXT && listing.updatedAt === '2026-10-29T12:00:00Z'))
  assert.match(files['store.json'], new RegExp(`example-source/${NEXT}/izumi/theme.json`))
  assert.equal(kept.length, 4, 'only the moving repository is downloaded and scanned')
})

test('a newer commit that fails, or a listing not yet reviewed, keeps the old pin', async () => {
  const NEXT = 'b'.repeat(40)
  const head = async () => ({ sha: NEXT })
  const urls = fixture().urls
  fixture({ commit: NEXT, urls, linux: { key: keyB }, windows: { key: keyB } })
  const changedKey = await updatePins({ plugins: [plugin({ signingKey: fingerprint(keyA) })], packs: [] }, ioFor(urls, { head }).io)
  assert.deepEqual(changedKey.listings, [])
  assert.match(changedKey.report.held[0].errors.join('\n'), /review a key change/)

  const clean = fixture().urls
  fixture({ commit: NEXT, urls: clean })
  const unreviewed = await updatePins({ plugins: [plugin()], packs: [] }, ioFor(clean, { head }).io)
  assert.deepEqual(unreviewed.listings, [])
  assert.match(unreviewed.report.held[0].errors[0], /no signingKey yet/)

  const scanned = await updatePins({ plugins: [plugin({ signingKey: fingerprint(keyA) })], packs: [] },
    ioFor(clean, { head, scan: () => { throw new Error('the virus scan flagged linux.izumi-ext: Win.Test FOUND') } }).io)
  assert.deepEqual(scanned.listings, [])
  assert.match(scanned.report.held[0].errors.join('\n'), /virus scan flagged/)
})

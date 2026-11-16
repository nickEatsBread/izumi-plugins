import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkPluginManifest, sha256 } from '../../scripts/lib.mjs'
import { parseMatches, pickLines } from './main.js'

const read = (name) => readFileSync(new URL(name, import.meta.url))

test('plugin.json is one izumi runs, and pins main.js', () => {
  const manifest = checkPluginManifest(JSON.parse(read('plugin.json').toString('utf8')))
  assert.equal(manifest.id, 'watch.izumi.jump-to-moment')
  assert.equal(sha256(read(manifest.main.path)), manifest.main.sha256, 'run node scripts/pin-main.mjs official/jump-to-moment')
})

const cues = Array.from({ length: 60 }, (_, i) => ({ start: i * 10, end: i * 10 + 5, text: i === 30 ? 'This soup tastes incredible!' : `line ${i}` }))

test('sends the windows around keyword hits, or everything when nothing matches', () => {
  assert.deepEqual(pickLines(cues, 'where he tastes the soup'), Array.from({ length: 11 }, (_, i) => 25 + i))
  assert.equal(pickLines(cues, 'the quiet bit').length, 60)
})

test('reads line numbers out of a reply and drops anything else', () => {
  assert.deepEqual(parseMatches('```json\n{"matches":[{"line":31,"reason":"he tastes it"},{"line":"x"}]}\n```'), [{ line: 31, reason: 'he tastes it' }])
  assert.deepEqual(parseMatches('no idea'), [])
  assert.deepEqual(parseMatches('{"matches": []}'), [])
})

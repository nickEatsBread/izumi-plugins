#!/usr/bin/env node
// Checks every listing at its pinned commit, and that store.json and packs/<id>/pack.json match what
// the listings produce.
//
//   node scripts/build.mjs            check (npm test)
//   node scripts/build.mjs --write    regenerate the files, and record a new plugin's signingKey
//   node scripts/build.mjs --scan     also run ClamAV over every file checked (CI always does)
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildStore, createIo, readListings, writeListing } from './lib.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const write = process.argv.includes('--write')
const io = createIo({ scan: process.argv.includes('--scan') })
const problems = []
let count = 0
try {
  const listings = readListings(root)
  count = listings.plugins.length + listings.packs.length
  const { files, keys, errors } = await buildStore(listings, io)
  problems.push(...errors.map((error) => error.message))
  for (const listing of listings.plugins) {
    if (listing.signingKey || !keys[listing.id]) continue
    if (write) writeListing(root, 'plugins', { ...listing, signingKey: keys[listing.id] })
    else problems.push(`plugins/${listing.id}: record the signer with "signingKey": "${keys[listing.id]}" (npm run build does it)`)
  }
  try {
    io.scan()
  } catch (error) {
    problems.push(error.message)
  }
  if (!problems.length) {
    for (const [path, content] of Object.entries(files)) {
      const file = join(root, path)
      if (existsSync(file) && readFileSync(file, 'utf8') === content) continue
      if (write) writeFileSync(file, content)
      else problems.push(`${path} is out of date: run npm run build`)
    }
  }
} catch (error) {
  problems.push(error.message)
} finally {
  io.close()
}
if (problems.length) {
  console.error(problems.map((problem) => `x ${problem}`).join('\n'))
  process.exit(1)
}
console.log(`Checked ${count} listing${count === 1 ? '' : 's'}${write ? ' and wrote store.json' : ''}.`)

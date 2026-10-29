#!/usr/bin/env node
// The hourly update (see updatePins in lib.mjs). Writes the moved listings and generated files, and
// update-report.json for the workflow: what moved, and what was held back and why.
//
//   GITHUB_TOKEN=… node scripts/update.mjs --scan
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createIo, readListings, updatePins, writeListing } from './lib.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const io = createIo({ token: process.env.GITHUB_TOKEN, scan: process.argv.includes('--scan') })
let report = { updated: [], held: [] }
try {
  const result = await updatePins(readListings(root), io)
  report = result.report
  for (const { kind, listing } of result.listings) writeListing(root, kind, listing)
  for (const [path, content] of Object.entries(result.files)) writeFileSync(join(root, path), content)
} finally {
  io.close()
  writeFileSync(join(root, 'update-report.json'), `${JSON.stringify(report, null, 2)}\n`)
}
for (const item of report.updated) console.log(`moved ${item.ids.join(', ')} to ${item.repo}@${item.commit.slice(0, 12)}`)
for (const item of report.held) console.log(`held ${item.repo}@${item.branch}:\n  ${item.errors.join('\n  ')}`)

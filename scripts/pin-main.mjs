#!/usr/bin/env node
// Pins a plugin's main file: writes its SHA-256 into plugin.json (main.sha256). Run after every edit.
//   node scripts/pin-main.mjs <folder with plugin.json>
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
if (!dir) { console.error('usage: node scripts/pin-main.mjs <folder with plugin.json>'); process.exit(1) }
const manifestPath = join(dir, 'plugin.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const code = readFileSync(join(dir, manifest.main.path), 'utf8')
manifest.main.sha256 = createHash('sha256').update(code, 'utf8').digest('hex')
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
console.log(`${manifest.id} ${manifest.version}: ${manifest.main.path} ${manifest.main.sha256}`)

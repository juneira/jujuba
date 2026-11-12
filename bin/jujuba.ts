#!/usr/bin/env bun
import { realpathSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

// `bun link` installs this file as a symlink, so resolve the real location
// before importing anything relative to the checkout.
const entry = realpathSync(fileURLToPath(import.meta.url))
const root = resolve(dirname(entry), "..")
process.chdir(root)

const moduleUrl = pathToFileURL(join(root, "scripts", "jujuba", "main.ts")).href
const { main } = (await import(moduleUrl)) as typeof import("../scripts/jujuba/main.js")

process.exit(await main({ root, argv: process.argv.slice(2) }))

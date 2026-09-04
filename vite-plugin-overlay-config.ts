// Vite plugin: reads config/overlays.yaml at build start, writes normalized
// JSON to src/data/generated/. During dev, watches the file and re-generates
// on change. The generated JSON is gitignored.
//
// Sibling of vite-plugin-csv-config.ts, kept separate so each plugin owns one
// config format.
//
// Validation here is deliberately thin: it checks only the fields the app
// dereferences, so a hand-edited file fails the build with a readable message
// instead of a runtime TypeError. Shape, enums, and colour format are the
// job of config/schemas/overlays.schema.json, which validates live in the editor.
// Whether `source` and the column names actually exist is checked against the
// overlay inventory the data build publishes in public/manifest.json, which is
// the only thing that knows.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { load as loadYaml } from 'js-yaml'
import type { Plugin } from 'vite'
import type { OverlayLayerDef, OverlayStyle } from './src/types'

const CONFIG_FILE = resolve('config/overlays.yaml')
const MANIFEST_FILE = resolve('public/manifest.json')
const OUT_DIR = resolve('src/data/generated')
const OUT_FILE = resolve(OUT_DIR, 'overlays.json')

const DRAW_KINDS = ['line', 'point', 'polygon']
const STYLE_TYPES = ['simple', 'categorical']

function fail(where: string, message: string): never {
  throw new Error(`[overlay-config] ${where}: ${message}`)
}

function str(where: string, key: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(where, `\`${key}\` is required and must be a non-empty string`)
  }
  return value
}

// Only `true` and `false` are booleans in YAML 1.2, which js-yaml follows.
// `on` and `yes` arrive as text, so a layer written `visible: on` would
// otherwise fall back to the default and stay switched off silently.
function bool(where: string, key: string, value: unknown): boolean {
  if (typeof value !== 'boolean') {
    fail(where, `\`${key}\` must be true or false (\`on\`, \`off\`, and \`yes\` are read as text, not booleans)`)
  }
  return value
}

function num(where: string, key: string, value: unknown): number {
  if (typeof value !== 'number') fail(where, `\`${key}\` must be a number, unquoted`)
  return value
}

function parseStyle(where: string, raw: unknown): OverlayStyle {
  if (raw === null || typeof raw !== 'object') fail(where, '`style` is required')
  const style = raw as Record<string, unknown>

  if (!STYLE_TYPES.includes(style.type as string)) {
    fail(where, `\`style.type\` must be one of ${STYLE_TYPES.join(', ')}`)
  }

  if (style.type === 'simple') {
    return { type: 'simple', color: str(where, 'style.color', style.color) }
  }

  const column = str(where, 'style.column', style.column)
  if (!Array.isArray(style.categories) || style.categories.length === 0) {
    fail(where, '`style.categories` must be a list with at least one entry')
  }
  const categories = style.categories.map((entry, i) => {
    const at = `${where} category ${i + 1}`
    if (entry === null || typeof entry !== 'object') fail(at, 'must be a mapping')
    const cat = entry as Record<string, unknown>
    if (cat.value === undefined || cat.value === null) fail(at, '`value` is required')
    return {
      value: cat.value as string | number,
      label: str(at, 'label', cat.label),
      color: str(at, 'color', cat.color),
    }
  })

  // A duplicated value is the likeliest copy-paste slip, and it breaks more
  // than the paint: two legend rows would share one key, so one checkbox
  // would drive both.
  const dupe = categories.find(
    (cat, i) => categories.findIndex((other) => other.value === cat.value) !== i,
  )
  if (dupe) fail(where, `duplicate category value \`${dupe.value}\``)

  const style2: OverlayStyle = { type: 'categorical', column, categories }
  if (style.other !== undefined) {
    const other = style.other as Record<string, unknown>
    style2.other = {
      label: str(where, 'style.other.label', other?.label),
      color: str(where, 'style.other.color', other?.color),
    }
  }
  return style2
}

function parseLayer(raw: unknown, index: number): OverlayLayerDef {
  const at = `layer ${index + 1}`
  if (raw === null || typeof raw !== 'object') fail(at, 'must be a mapping')
  const layer = raw as Record<string, unknown>

  const id = str(at, 'id', layer.id)
  const where = `layer "${id}"`

  if (!DRAW_KINDS.includes(layer.draw as string)) {
    fail(where, `\`draw\` must be one of ${DRAW_KINDS.join(', ')}`)
  }

  const def: OverlayLayerDef = {
    id,
    label: str(where, 'label', layer.label),
    source: str(where, 'source', layer.source),
    draw: layer.draw as OverlayLayerDef['draw'],
    // Defaults are applied here so the app never handles undefined. A key that
    // is present but the wrong type fails rather than falling back, so a
    // mistyped value can never look like it was accepted.
    visible: layer.visible === undefined ? false : bool(where, 'visible', layer.visible),
    width: layer.width === undefined ? 1 : num(where, 'width', layer.width),
    opacity: layer.opacity === undefined ? 1 : num(where, 'opacity', layer.opacity),
    style: parseStyle(where, layer.style),
  }

  if (layer.where !== undefined) {
    const filter = layer.where as Record<string, unknown>
    if (filter?.equals === undefined || filter.equals === null) {
      fail(where, '`where.equals` is required when `where` is set')
    }
    def.where = {
      column: str(where, 'where.column', filter.column),
      equals: filter.equals as string | number | boolean,
    }
  }

  return def
}

function parseConfig(text: string): OverlayLayerDef[] {
  const doc = loadYaml(text)
  if (doc === null || typeof doc !== 'object') {
    fail('config/overlays.yaml', 'file is empty or not a mapping')
  }
  const layers = (doc as Record<string, unknown>).layers
  if (!Array.isArray(layers)) fail('config/overlays.yaml', '`layers` must be a list')

  const defs = layers.map(parseLayer)
  const seen = new Set<string>()
  for (const def of defs) {
    if (seen.has(def.id)) fail(`layer "${def.id}"`, 'duplicate id')
    seen.add(def.id)
  }
  return defs
}

// A typo in `source` or a column name is the one mistake that otherwise
// produces no error anywhere: the layer simply draws nothing, and the site
// deploys clean. Only the data build knows what the tiles contain, so it
// publishes an inventory in the manifest and this checks against it.
//
// One name per tileset is what makes this checkable at all: a build-config key
// is the manifest key, the filename, and the layer name inside the tiles, so
// `source` is the only thing the config has to get right.
function crossCheckManifest(defs: OverlayLayerDef[]): void {
  if (!existsSync(MANIFEST_FILE)) {
    console.warn('[overlay-config] no public/manifest.json; skipped tileset checks')
    return
  }

  const manifest = JSON.parse(readFileSync(MANIFEST_FILE, 'utf-8'))
  const overlays: Record<string, { fields?: string[] }> = manifest.overlays ?? {}
  const available = Object.keys(overlays).sort().join(', ') || '(none)'

  for (const def of defs) {
    const where = `layer "${def.id}"`

    const tileset = overlays[def.source]
    if (!tileset) {
      fail(
        where,
        `unknown source "${def.source}"; the data build publishes: ${available}. ` +
          'Add it under `overlays` in tools/data-build/build-config.yaml and rebuild, ' +
          'or point this layer at a published tileset.',
      )
    }

    const fields = tileset.fields ?? []
    const checkColumn = (column: string, key: string) => {
      if (!fields.includes(column)) {
        fail(where, `\`${key}\` names "${column}", which is not in ${def.source}; available: ${fields.join(', ')}`)
      }
    }
    if (def.style.type === 'categorical') checkColumn(def.style.column, 'style.column')
    if (def.where) checkColumn(def.where.column, 'where.column')
  }
}

function generate(): void {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
  const defs = parseConfig(readFileSync(CONFIG_FILE, 'utf-8'))
  crossCheckManifest(defs)
  writeFileSync(OUT_FILE, JSON.stringify(defs, null, 2) + '\n')
  console.log(`[overlay-config] generated ${defs.length} overlay layers`)
}

export function overlayConfigPlugin(): Plugin {
  return {
    name: 'overlay-config',

    buildStart() {
      generate()
    },

    // Vite's own watcher rather than fs.watchFile: it fires on save instead of
    // polling, and needs no teardown. A returned function here would be run as
    // a post hook during server startup, not as cleanup.
    configureServer(server) {
      server.watcher.add(CONFIG_FILE)
      server.watcher.on('change', (file) => {
        if (resolve(file) !== CONFIG_FILE) return
        console.log('[overlay-config] config/overlays.yaml changed, regenerating...')
        try {
          generate()
        } catch (error) {
          // Keep the dev server alive so the next save can fix the file.
          console.error((error as Error).message)
        }
      })
    },
  }
}

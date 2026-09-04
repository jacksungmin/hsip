// Vite plugin: reads config/app.yaml at build start and turns it into the two
// forms the app consumes — JSON for the strings the components read, and a
// stylesheet for the theme colours. Also stamps the browser tab title into
// index.html, which is not Svelte and so cannot import anything.
//
// During dev, watches the file and re-generates on change. The generated files
// are gitignored.
//
// Third sibling of vite-plugin-csv-config.ts and vite-plugin-overlay-config.ts,
// kept separate so each plugin owns one config format. Unlike those two, this
// one has a transformIndexHtml hook, because part of what it configures lives
// in the HTML shell rather than in the bundle.
//
// Colours become CSS as generated text, so they are validated as hex and
// nothing else. A permissive check would let a value like `red; } html {` close
// the rule early and inject arbitrary CSS from a config file.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { load as loadYaml } from 'js-yaml'
import type { Plugin } from 'vite'
import type { AppConfig } from './src/types'

const CONFIG_FILE = resolve('config/app.yaml')
const OUT_DIR = resolve('src/data/generated')
const OUT_JSON = resolve(OUT_DIR, 'appConfig.json')
const OUT_CSS = resolve(OUT_DIR, 'theme.css')

// #rgb, #rgba, #rrggbb, #rrggbbaa.
const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

function fail(where: string, message: string): never {
  throw new Error(`[app-config] ${where}: ${message}`)
}

function section(doc: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = doc[key]
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('config/app.yaml', `\`${key}\` is required and must be a mapping`)
  }
  return value as Record<string, unknown>
}

function str(where: string, key: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(where, `\`${key}\` is required and must be a non-empty string`)
  }
  return value.trim()
}

function color(where: string, key: string, value: unknown): string {
  const text = str(where, key, value)
  if (!HEX.test(text)) {
    fail(
      where,
      `\`${key}\` must be a hex colour like "#025773" (got ${JSON.stringify(text)}). ` +
        'Other CSS colour forms are not accepted here.',
    )
  }
  return text
}

function num(where: string, key: string, value: unknown, fallback: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(where, `\`${key}\` must be a number, unquoted`)
  }
  return value
}

// A raster tile template is the URL that names the tile-address placeholders;
// a vector style URL never does. That makes the distinction readable off the
// URL, so config does not have to declare a `type` that could contradict it.
export function isRasterTemplate(url: string): boolean {
  return url.includes('{z}') && url.includes('{x}') && url.includes('{y}')
}

function parseBasemap(where: string, raw: Record<string, unknown>): AppConfig['basemap'] {
  const url = str(where, 'url', raw.url)

  if (!/^https?:\/\//.test(url)) {
    fail(where, `\`url\` must be an http(s) URL (got ${JSON.stringify(url)})`)
  }

  // `{s}` is a Leaflet-style subdomain placeholder, and most tile URLs found
  // in the wild carry one. MapLibre has no such substitution, so left alone it
  // would request a literal "{s}." host and every tile would fail silently.
  //
  // Dropped rather than rejected, because the correct reading is unambiguous:
  // the sharded subdomains were aliases added on top of a canonical host, so
  // the bare host serves the same tiles (verified against OSM, Carto,
  // OpenTopoMap, Thunderforest). Sharding was an HTTP/1.1 workaround for the
  // per-host connection limit and is counterproductive under HTTP/2 anyway.
  //
  // Warned rather than dropped quietly, so config and runtime do not disagree
  // about the URL indefinitely. Auto-fixing is only defensible here because
  // there is one correct interpretation; where intent is genuinely ambiguous
  // (a colour, a column name) this file fails instead of guessing.
  const shardedUrl = url.replace(/\{s\}\./, '')
  if (shardedUrl !== url) {
    console.warn(
      `[app-config] basemap: dropped the "{s}." subdomain placeholder from \`url\`; ` +
        'MapLibre does not substitute it and the bare host serves the same tiles. ' +
        `Update config/app.yaml to:\n  ${shardedUrl}`,
    )
  }

  // A partially-written raster template is the one failure the sniff cannot
  // catch: it would be read as a vector style URL, handed to the map library,
  // and produce an unexplained blank map rather than an error.
  const placeholders = ['{z}', '{x}', '{y}'].filter((p) => shardedUrl.includes(p))
  if (placeholders.length > 0 && placeholders.length < 3) {
    fail(
      where,
      `\`url\` looks like a raster tile template but only has ${placeholders.join(', ')}. ` +
        'A raster template needs all of {z}, {x}, {y}; a vector style URL should have none.',
    )
  }

  return {
    url: shardedUrl,
    attribution: str(where, 'attribution', raw.attribution),
    maxZoom: num(where, 'maxZoom', raw.maxZoom, 19),
    tileSize: num(where, 'tileSize', raw.tileSize, 256),
  }
}

function parseConfig(text: string): AppConfig {
  const doc = loadYaml(text)
  if (doc === null || typeof doc !== 'object') {
    fail('config/app.yaml', 'file is empty or not a mapping')
  }
  const root = doc as Record<string, unknown>

  const identity = section(root, 'identity')
  const support = section(root, 'support')
  const theme = section(root, 'theme')
  const basemap = section(root, 'basemap')

  return {
    identity: {
      appName: str('identity', 'appName', identity.appName),
      subtitle: str('identity', 'subtitle', identity.subtitle),
      fullName: str('identity', 'fullName', identity.fullName),
    },
    support: {
      email: str('support', 'email', support.email),
    },
    theme: {
      primary: color('theme', 'primary', theme.primary),
      primaryPlanning: color('theme', 'primaryPlanning', theme.primaryPlanning),
      foreground: color('theme', 'foreground', theme.foreground),
      destructive: color('theme', 'destructive', theme.destructive),
    },
    basemap: parseBasemap('basemap', basemap),
  }
}

// One configured colour drives several design tokens. Most of these tokens are
// already the same value in src/app.css — `--ring` and `--sidebar-primary` are
// duplicates of `--primary`, and six tokens duplicate `--foreground` — so
// restating them here keeps that internal consistency instead of leaving half
// the UI on the default palette.
//
// This sheet loads after app.css and overrides only these tokens, so app.css
// stays the full default palette and the diff between "branded" and "stock" is
// exactly this file.
function renderCss(theme: AppConfig['theme']): string {
  const { primary, primaryPlanning, foreground, destructive } = theme
  return `/* Generated from config/app.yaml by vite-plugin-app-config.ts.
   Do not edit: rewritten on every build. Change the colours in
   config/app.yaml, or the palette they override in src/app.css. */

:root {
  --primary: ${primary};
  --ring: ${primary};
  --sidebar-primary: ${primary};
  --sidebar-ring: ${primary};

  --foreground: ${foreground};
  --card-foreground: ${foreground};
  --popover-foreground: ${foreground};
  --secondary-foreground: ${foreground};
  --accent-foreground: ${foreground};
  --sidebar-foreground: ${foreground};
  --sidebar-accent-foreground: ${foreground};

  --destructive: ${destructive};
}

[data-mode="planning"] {
  --primary: ${primaryPlanning};
  --ring: ${primaryPlanning};
}
`
}

let cached: AppConfig | null = null

function generate(): AppConfig {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
  const config = parseConfig(readFileSync(CONFIG_FILE, 'utf-8'))
  writeFileSync(OUT_JSON, JSON.stringify(config, null, 2) + '\n')
  writeFileSync(OUT_CSS, renderCss(config.theme))
  cached = config
  console.log(`[app-config] generated theme and identity for "${config.identity.appName}"`)
  return config
}

export function appConfigPlugin(): Plugin {
  return {
    name: 'app-config',

    buildStart() {
      generate()
    },

    // The tab title lives in index.html, outside the bundle, so it cannot be
    // imported like the rest of the config. index.html keeps a hardcoded title
    // as the fallback for any path that skips this hook.
    transformIndexHtml(html) {
      const config = cached ?? generate()
      const title = config.identity.appName.replace(/[<>&]/g, '')
      return html.replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`)
    },

    configureServer(server) {
      server.watcher.add(CONFIG_FILE)
      server.watcher.on('change', (file) => {
        if (resolve(file) !== CONFIG_FILE) return
        console.log('[app-config] config/app.yaml changed, regenerating...')
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

// Web Worker entry. Boots sqlite-wasm, opens a DB on OPFS-SAH pool VFS
// (or in-memory fallback), and answers RPC messages from sqliteClient.
//
// Crash data arrives as a pre-built .db downloaded from a
// content-hashed URL (loadDb message): crashes table, crash_rtree,
// and flag blobs are all built by tools/data-build/. Freshness is
// URL equality — the source URL of the last download is kept in
// _cache_meta, and since hashed filenames make a URL identify its
// bytes, a match means the OPFS copy is current with no network
// request at all. importDb replaces the whole file; the source-url
// row is re-written into the fresh copy after each import.

import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import type { Sqlite3Static, Database } from '@sqlite.org/sqlite-wasm'
import type { Polygon, MultiPolygon } from 'geojson'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import turfBbox from '@turf/bbox'
import type { BBox } from 'geojson'
import type { CrashRecord, CrashFilter, BreakdownResult } from '../../types'
import { EA_IDS } from '../../data/emphasisAreas'
import { HSIP_FIELDS } from '../../data/hsipWorkcodes'
import { decodeFlags, countFromBytes } from './flagCodec'

type Backend = 'opfs-sah' | 'memory'
type PoolUtil = Awaited<ReturnType<Sqlite3Static['installOpfsSAHPoolVfs']>>

const DB_FILENAME = '/hsip.sqlite3'
const SAH_POOL_NAME = 'hsip-sah-pool'
const DB_SOURCE_KEY = 'db_file'

let sqlite3: Sqlite3Static
let db: Database | null = null
let backend: Backend = 'memory'
let poolUtil: PoolUtil | null = null

const ready = (async () => {
  sqlite3 = await sqlite3InitModule()
  try {
    poolUtil = await sqlite3.installOpfsSAHPoolVfs({ name: SAH_POOL_NAME, initialCapacity: 16 })
    db = new poolUtil.OpfsSAHPoolDb(DB_FILENAME)
    backend = 'opfs-sah'
  } catch (e) {
    console.warn('OPFS-SAH unavailable, falling back to in-memory SQLite', e)
    db = new sqlite3.oo1.DB(':memory:', 'c')
    backend = 'memory'
  }
  db.exec('PRAGMA synchronous = NORMAL')
  initSchema(db)
})()

function initSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _cache_meta (
      layer TEXT PRIMARY KEY,
      ingested_at INTEGER NOT NULL,
      source_url TEXT
    );
  `)
}

// --- Pre-built crash .db download + import ---

type LoadDbResult = { source: 'cache' | 'download'; rowCount: number }
type ProgressFn = (loaded: number, total: number | null) => void

function hasCrashData(db: Database): boolean {
  const rows: unknown[][] = []
  db.exec({ sql: "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'crashes'", rowMode: 'array', resultRows: rows } as any)
  return rows.length > 0
}

function crashRowCount(db: Database): number {
  const rows: unknown[][] = []
  db.exec({ sql: 'SELECT COUNT(*) FROM crashes', rowMode: 'array', resultRows: rows } as any)
  return Number(rows[0]?.[0] ?? 0)
}

// Earlier versions stored a JSON validator blob (ETag/Last-Modified)
// here; it never equals a URL, so old caches simply re-download once
// and self-heal.
function getStoredSourceUrl(db: Database): string | null {
  const rows: Record<string, unknown>[] = []
  db.exec({ sql: 'SELECT source_url FROM _cache_meta WHERE layer = ?', bind: [DB_SOURCE_KEY], rowMode: 'object', resultRows: rows } as any)
  const raw = rows[0]?.source_url
  return typeof raw === 'string' ? raw : null
}

function storeSourceUrl(db: Database, url: string): void {
  db.exec({
    sql: 'INSERT OR REPLACE INTO _cache_meta (layer, ingested_at, source_url) VALUES (?, ?, ?)',
    bind: [DB_SOURCE_KEY, Date.now(), url],
  } as any)
}

// First 16 bytes of every SQLite file. Also catches a Git LFS pointer
// (text) being served in place of the real binary.
function looksLikeSQLite(bytes: Uint8Array): boolean {
  const magic = 'SQLite format 3\u0000'
  if (bytes.length < magic.length) return false
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic.charCodeAt(i)) return false
  }
  return true
}

async function readBodyWithProgress(resp: Response, onProgress: ProgressFn): Promise<Uint8Array> {
  const lenHeader = resp.headers.get('Content-Length')
  const total = lenHeader ? Number(lenHeader) : null
  if (!resp.body) {
    const buf = new Uint8Array(await resp.arrayBuffer())
    onProgress(buf.byteLength, total)
    return buf
  }
  const reader = resp.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  let lastReported = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.byteLength
    if (loaded - lastReported > 4 * 1024 * 1024) {
      lastReported = loaded
      onProgress(loaded, total)
    }
  }
  onProgress(loaded, total)
  const out = new Uint8Array(loaded)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
}

async function loadDb(url: string, onProgress: ProgressFn): Promise<LoadDbResult> {
  if (!db) throw new Error('sqlite db not initialized')

  const cached = hasCrashData(db)
  if (cached && getStoredSourceUrl(db) === url) {
    return { source: 'cache', rowCount: crashRowCount(db) }
  }

  let resp: Response
  try {
    resp = await fetch(url)
  } catch (err) {
    if (cached) {
      console.warn('[sqliteWorker] db download failed, using cached copy', err)
      return { source: 'cache', rowCount: crashRowCount(db) }
    }
    throw err
  }

  if (!resp.ok) {
    if (cached) {
      console.warn(`[sqliteWorker] db download HTTP ${resp.status}, using cached copy`)
      return { source: 'cache', rowCount: crashRowCount(db) }
    }
    throw new Error(`db download failed: HTTP ${resp.status}`)
  }

  const bytes = await readBodyWithProgress(resp, onProgress)
  if (!looksLikeSQLite(bytes)) {
    const msg = 'downloaded db is not a SQLite file (Git LFS pointer served instead of binary?)'
    if (cached) {
      console.warn(`[sqliteWorker] ${msg}, using cached copy`)
      return { source: 'cache', rowCount: crashRowCount(db) }
    }
    throw new Error(msg)
  }

  // Header bytes 18/19 are the journal-mode version (1 = rollback,
  // 2 = WAL). A WAL-stamped file cannot open its -wal/-shm sidecars
  // in wasm (in-memory deserialize fails with SQLITE_CANTOPEN), and
  // since sidecars are never downloaded the file is by definition
  // checkpointed, so flipping to rollback mode is a safe conversion.
  // The pipeline builds rollback-mode artifacts; this guards against
  // a db built by an older pipeline or another tool.
  if (bytes[18] === 2 || bytes[19] === 2) {
    console.warn('[sqliteWorker] downloaded db is WAL-mode, converting header to rollback-journal')
    bytes[18] = 1
    bytes[19] = 1
  }

  db.close()
  db = null
  try {
    if (backend === 'opfs-sah' && poolUtil) {
      await poolUtil.importDb(DB_FILENAME, bytes)
      db = new poolUtil.OpfsSAHPoolDb(DB_FILENAME)
    } else {
      // In-memory: point a fresh connection at the downloaded bytes.
      // FREEONCLOSE hands buffer ownership to SQLite.
      const memDb = new sqlite3.oo1.DB(':memory:', 'c')
      try {
        const p = sqlite3.wasm.allocFromTypedArray(bytes)
        const rc = sqlite3.capi.sqlite3_deserialize(
          memDb.pointer!, 'main', p, bytes.byteLength, bytes.byteLength,
          sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
        )
        memDb.checkRc(rc)
      } catch (err) {
        memDb.close()
        throw err
      }
      db = memDb
    }
  } catch (err) {
    // Import failed after the old handle was closed. Reopen something
    // usable so the worker keeps answering RPCs (the error still
    // propagates to the caller via the RPC reply).
    db = backend === 'opfs-sah' && poolUtil
      ? new poolUtil.OpfsSAHPoolDb(DB_FILENAME)
      : new sqlite3.oo1.DB(':memory:', 'c')
    db.exec('PRAGMA synchronous = NORMAL')
    initSchema(db)
    throw err
  }
  db.exec('PRAGMA synchronous = NORMAL')
  initSchema(db)
  storeSourceUrl(db, url)
  return { source: 'download', rowCount: crashRowCount(db) }
}

// TODO: discuss if we should let the store build the where clause and use directly in query.
function buildWhere(filter: CrashFilter): { clause: string; params: (string | null)[] } {
  const conditions: string[] = []
  const params: (string | null)[] = []
  if (filter.countyId != null) { conditions.push('county_id = ?'); params.push(filter.countyId) }
  if (filter.cityId != null) { conditions.push('city_id = ?'); params.push(filter.cityId) }
  return {
    clause: conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '',
    params,
  }
}

const CRASH_COLS = ['id', 'date', 'severity', 'lon', 'lat', 'county_id', 'city_id', 'ea_flags', 'hsip_flags']

function rowToCrashRecord(row: Record<string, unknown>): CrashRecord {
  const eaFlags = decodeFlags(EA_IDS, row.ea_flags as Uint8Array)
  const hsipFlags = decodeFlags(HSIP_FIELDS, row.hsip_flags as Uint8Array)
  return {
    id: String(row.id),
    date: row.date as string,
    severity: row.severity as string,
    lon: row.lon as number,
    lat: row.lat as number,
    location: { type: 'Point' as const, coordinates: [row.lon as number, row.lat as number] },
    countyId: row.county_id as string,
    cityId: (row.city_id as string | null) ?? null,
    ...eaFlags,
    ...hsipFlags,
  } as CrashRecord
}

function queryCrashes(db: Database, filter: CrashFilter): CrashRecord[] {
  const t0 = performance.now()
  const { clause, params } = buildWhere(filter)
  const sql = `SELECT ${CRASH_COLS.join(', ')} FROM crashes${clause}`
  const rows: Record<string, unknown>[] = []
  db.exec({ sql, bind: params, rowMode: 'object', resultRows: rows } as any)
  const tSql = performance.now()
  const records = rows.map(rowToCrashRecord)
  console.debug(
    `[queryCrashes] sql=${(tSql - t0).toFixed(0)}ms decode=${(performance.now() - tSql).toFixed(0)}ms rows=${rows.length}`,
  )
  return records
}

function countByEA(db: Database, filter: CrashFilter): BreakdownResult {
  // EA_IDS are compile-time constants from emphasisAreas.ts, not user input.
  const eaSums = EA_IDS.map((ea) => `SUM(${ea}) as ${ea}`).join(', ')
  const { clause, params } = buildWhere(filter)
  const sql = `SELECT COUNT(*) as totalCrashes, ${eaSums} FROM crashes${clause}`
  const rows: Record<string, number>[] = []
  db.exec({ sql, bind: params, rowMode: 'object', resultRows: rows })

  const row = rows[0]
  if (!row) return { totalCrashes: 0, counts: {} }
  const counts: Record<string, number> = {}
  for (const ea of EA_IDS) counts[ea] = row[ea] ?? 0
  return { totalCrashes: row.totalCrashes, counts }
}

// --- Polygon-based spatial queries (R*Tree bbox pre-filter + Turf PIP) ---

// Shared bbox bind for R*Tree pre-filter. Returns [minX, maxX, minY, maxY]
// matching the R*Tree column order in the WHERE clause.
function bboxBind(geometry: Polygon | MultiPolygon): [number, number, number, number] {
  const [minX, minY, maxX, maxY] = turfBbox(geometry) as BBox
  return [minX, maxX, minY, maxY]
}

// Full record query: base cols + packed blobs (decoded in rowToCrashRecord)
const BBOX_SELECT_SQL = `
  SELECT ${CRASH_COLS.map((c) => `c.${c}`).join(', ')} FROM crash_rtree r
  JOIN crashes c ON c.id = r.id
  WHERE r.maxX >= ? AND r.minX <= ?
    AND r.maxY >= ? AND r.minY <= ?
`

function queryByPolygon(db: Database, geometry: Polygon | MultiPolygon): CrashRecord[] {
  const t0 = performance.now()
  const rows: Record<string, unknown>[] = []
  db.exec({ sql: BBOX_SELECT_SQL, bind: bboxBind(geometry), rowMode: 'object', resultRows: rows } as any)
  const tSql = performance.now()

  const results: CrashRecord[] = []
  for (const row of rows) {
    if (booleanPointInPolygon([row.lon as number, row.lat as number], geometry)) {
      results.push(rowToCrashRecord(row))
    }
  }
  console.debug(
    `[spatialQuery] sql=${(tSql - t0).toFixed(1)}ms pip=${(performance.now() - tSql).toFixed(1)}ms | bbox=${rows.length} hits=${results.length}`,
  )
  return results
}

// Batch fetch by crash id, for resolving Site.crashIds to records.
// Chunked IN lists: this project hit SQLite's bind-parameter ceiling
// early on (breakdown view), so chunk conservatively rather than
// trusting the build's SQLITE_MAX_VARIABLE_NUMBER.
const ID_BATCH_SIZE = 900

function queryByIds(db: Database, ids: string[]): CrashRecord[] {
  const t0 = performance.now()
  const records: CrashRecord[] = []
  for (let i = 0; i < ids.length; i += ID_BATCH_SIZE) {
    const chunk = ids.slice(i, i + ID_BATCH_SIZE)
    const rows: Record<string, unknown>[] = []
    db.exec({
      sql: `SELECT ${CRASH_COLS.join(', ')} FROM crashes WHERE id IN (${chunk.map(() => '?').join(',')})`,
      bind: chunk.map((id) => Number(id)),
      rowMode: 'object',
      resultRows: rows,
    } as any)
    for (const row of rows) records.push(rowToCrashRecord(row))
  }
  console.debug(
    `[queryByIds] ${(performance.now() - t0).toFixed(1)}ms ids=${ids.length} rows=${records.length}`,
  )
  return records
}

// Narrow count query: only lon, lat, ea_flags. Array mode avoids object allocation.
const COUNT_SELECT_SQL = `
  SELECT c.lon, c.lat, c.ea_flags FROM crash_rtree r
  JOIN crashes c ON c.id = r.id
  WHERE r.maxX >= ? AND r.minX <= ?
    AND r.maxY >= ? AND r.minY <= ?
`

function countByEAPolygon(db: Database, geometry: Polygon | MultiPolygon): BreakdownResult {
  const t0 = performance.now()
  const rows: unknown[][] = []
  db.exec({ sql: COUNT_SELECT_SQL, bind: bboxBind(geometry), rowMode: 'array', resultRows: rows } as any)
  const tSql = performance.now()

  let totalCrashes = 0
  const counts: Record<string, number> = {}
  for (const ea of EA_IDS) counts[ea] = 0
  for (const row of rows) {
    if (booleanPointInPolygon([row[0] as number, row[1] as number], geometry)) {
      totalCrashes++
      countFromBytes(EA_IDS, row[2] as Uint8Array, counts)
    }
  }
  console.debug(
    `[spatialCount] sql=${(tSql - t0).toFixed(1)}ms pip=${(performance.now() - tSql).toFixed(1)}ms | bbox=${rows.length} hits=${totalCrashes}`,
  )
  return { totalCrashes, counts }
}

type InMessage =
  | { id: number; type: 'ping' }
  | { id: number; type: 'loadDb'; payload: { url: string } }
  | { id: number; type: 'query'; payload: CrashFilter }
  | { id: number; type: 'countByEA'; payload: CrashFilter }
  | { id: number; type: 'queryByPolygon'; payload: Polygon | MultiPolygon }
  | { id: number; type: 'countByEAPolygon'; payload: Polygon | MultiPolygon }
  | { id: number; type: 'queryByIds'; payload: string[] }

self.onmessage = async (e: MessageEvent<InMessage>) => {
  const msg = e.data
  try {
    await ready
    if (!db) throw new Error('sqlite db not initialized')

    if (msg.type === 'ping') {
      self.postMessage({ id: msg.id, ok: true, backend, sqliteVersion: sqlite3.version.libVersion })
      return
    }
    if (msg.type === 'loadDb') {
      const result = await loadDb(msg.payload.url, (loaded, total) => {
        self.postMessage({ id: msg.id, progress: { loaded, total } })
      })
      self.postMessage({ id: msg.id, ok: true, ...result })
      return
    }
    if (msg.type === 'query') {
      const records = queryCrashes(db, msg.payload)
      self.postMessage({ id: msg.id, ok: true, records })
      return
    }
    if (msg.type === 'countByEA') {
      const result = countByEA(db, msg.payload)
      self.postMessage({ id: msg.id, ok: true, result })
      return
    }
    if (msg.type === 'queryByPolygon') {
      const records = queryByPolygon(db, msg.payload)
      self.postMessage({ id: msg.id, ok: true, records })
      return
    }
    if (msg.type === 'countByEAPolygon') {
      const result = countByEAPolygon(db, msg.payload)
      self.postMessage({ id: msg.id, ok: true, result })
      return
    }
    if (msg.type === 'queryByIds') {
      const records = queryByIds(db, msg.payload)
      self.postMessage({ id: msg.id, ok: true, records })
      return
    }
    const unknown = msg as { id: number; type: string }
    self.postMessage({ id: unknown.id, ok: false, error: `unknown message type: ${unknown.type}` })
  } catch (err) {
    self.postMessage({
      id: msg.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// Main-thread RPC wrapper around sqliteWorker.
//
// Each call sends a unique correlation id; the worker echoes it on reply.
// Pending map keys those reply handlers. init() is idempotent and memoised
// so multiple stores can await the same boot.

import type { Polygon, MultiPolygon } from 'geojson'
import type { CrashRecord, CrashFilter, BreakdownResult } from '../../types'
import { reportError } from '../errorReporter'

export type Backend = 'opfs-sah' | 'memory'
export type InitResult = { backend: Backend; sqliteVersion: string }

const worker = new Worker(new URL('./sqliteWorker.ts', import.meta.url), { type: 'module' })

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void }
export type ProgressFn = (loaded: number, total: number | null) => void

const pending = new Map<number, Pending>()
const progressHandlers = new Map<number, ProgressFn>()
let nextId = 1

// A message with `progress` is an interim update for a still-pending
// call; anything else settles the call.
worker.onmessage = (
  e: MessageEvent<{ id: number; ok?: boolean; error?: string; progress?: { loaded: number; total: number | null } } & Record<string, unknown>>,
) => {
  const { id, ok, error, progress, ...rest } = e.data
  if (progress) {
    progressHandlers.get(id)?.(progress.loaded, progress.total)
    return
  }
  const p = pending.get(id)
  if (!p) return
  pending.delete(id)
  progressHandlers.delete(id)
  if (ok) p.resolve(rest)
  else p.reject(new Error(error ?? 'sqliteWorker: unknown error'))
}

// The worker runs on its own thread, so a failure inside it reaches neither
// the window error listener nor a Svelte boundary. Fatal: every crash figure
// comes through this worker.
worker.onerror = (e) => {
  const err = new Error(`sqliteWorker error: ${e.message}`)
  for (const [, p] of pending) p.reject(err)
  pending.clear()
  progressHandlers.clear()
  reportError(err, {
    where: 'crash database worker',
    fatal: true,
    advice:
      'Something went wrong with crash data query. Try reloading.',
  })
}

function call<T>(type: string, payload?: unknown, onProgress?: ProgressFn): Promise<T> {
  const id = nextId++
  if (onProgress) progressHandlers.set(id, onProgress)
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    worker.postMessage({ id, type, payload })
  })
}

let initPromise: Promise<InitResult> | null = null
export function init(): Promise<InitResult> {
  if (!initPromise) initPromise = call<InitResult>('ping')
  return initPromise
}

export type DbLoadResult = { source: 'cache' | 'download'; rowCount: number }

// Download the pre-built crash .db and import it; skipped entirely
// (no request) when the stored source URL already matches, since
// content-hashed URLs identify their bytes. Progress reports
// downloaded bytes.
export async function loadCrashDb(url: string, onProgress?: ProgressFn): Promise<DbLoadResult> {
  await init()
  return call<DbLoadResult>('loadDb', { url }, onProgress)
}

export async function queryCrashes(filter: CrashFilter): Promise<CrashRecord[]> {
  await init()
  const r = await call<{ records: CrashRecord[] }>('query', filter)
  return r.records
}

export async function countByEA(filter: CrashFilter): Promise<BreakdownResult> {
  await init()
  const r = await call<{ result: BreakdownResult }>('countByEA', filter)
  return r.result
}

// JSON round-trip strips Svelte 5 $state Proxies, which are not
// structured-cloneable and would fail in worker.postMessage.
function toPlain<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

export async function queryByPolygon(geometry: Polygon | MultiPolygon): Promise<CrashRecord[]> {
  await init()
  const r = await call<{ records: CrashRecord[] }>('queryByPolygon', toPlain(geometry))
  return r.records
}

export async function countByEAPolygon(geometry: Polygon | MultiPolygon): Promise<BreakdownResult> {
  await init()
  const r = await call<{ result: BreakdownResult }>('countByEAPolygon', toPlain(geometry))
  return r.result
}

// Batch fetch by crash id, for resolving Site.crashIds to records.
// The id list crosses via postMessage and the worker chunks the SQL
// internally, so callers never see SQLite's bind-parameter limit.
// Spread copies out of any $state proxy (not structured-cloneable).
export async function queryByIds(ids: string[]): Promise<CrashRecord[]> {
  await init()
  const r = await call<{ records: CrashRecord[] }>('queryByIds', [...ids])
  return r.records
}



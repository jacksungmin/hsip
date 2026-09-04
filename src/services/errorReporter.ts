// The single place a failure goes, per docs/07 "Error handling: one reporter,
// two surfaces".
//
// The envelope builder and the log buffer are pure and exported on their own
// so they can be tested without a browser.

import { APP_BUILD } from '../data/buildInfo'
import { dataManifest } from '../state/dataManifest.svelte'
import { errorState } from '../state/errorState.svelte'

export type ErrorEnvelope = {
  // Internal, for keying a notice so it can be dismissed. Never displayed:
  // `where` is already the human-readable name for what failed.
  id: number
  at: string
  appBuild: string
  dataBuild: string
  // Where in the app it happened, e.g. 'boot / download-crashes'. Free text:
  // it is read by a person, not matched on.
  where: string
  // What the person on screen can do about it, if anything.
  advice: string | null
  message: string
  stack: string | null
  browser: string
  // The last lines the app logged on its way here.
  recent: string[]
  fatal: boolean
}

export type ReportContext = {
  where: string
  fatal: boolean
  advice?: string
}

// ---------------------------------------------------------------------------
// Recent log lines
// ---------------------------------------------------------------------------

const RECENT_LIMIT = 50
const LINE_LIMIT = 300

// A ring buffer: this runs for the whole session and only the tail is read.
const lines: string[] = []

// Set while reportError writes its own console line, so a failure that repeats
// hundreds of times does not fill the buffer with its own echoes.
let suppressCapture = false

function formatArg(arg: unknown): string {
  if (typeof arg === 'string') return arg
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`
  if (arg === null || arg === undefined) return String(arg)
  try {
    return JSON.stringify(arg)
  } catch {
    // Circular structures, and anything else JSON refuses.
    return String(arg)
  }
}

export const logBuffer = {
  push(level: string, args: unknown[]): void {
    if (suppressCapture) return
    const elapsed = Math.round(performance.now())
    const body = args.map(formatArg).join(' ')
    const line = `+${elapsed}ms ${level} ${body}`
    lines.push(line.length > LINE_LIMIT ? `${line.slice(0, LINE_LIMIT)}…` : line)
    if (lines.length > RECENT_LIMIT) lines.shift()
  },

  snapshot(): string[] {
    return [...lines]
  },

  clear(): void {
    lines.length = 0
  },
}

// Wraps the console so existing logging is captured without touching the ~40
// places that call it.
let consoleCaptured = false

export function installConsoleCapture(): void {
  if (consoleCaptured) return
  consoleCaptured = true
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      logBuffer.push(level, args)
      original(...args)
    }
  }
}

// ---------------------------------------------------------------------------
// The envelope
// ---------------------------------------------------------------------------

// Everything ambient the builder needs, passed in rather than read, so a test
// can produce a byte-identical envelope without a browser or a loaded manifest.
export type EnvelopeAmbient = {
  id: number
  at: string
  appBuild: string
  dataBuild: string
  browser: string
  recent: string[]
}

export function buildEnvelope(
  error: unknown,
  context: ReportContext,
  ambient: EnvelopeAmbient,
): ErrorEnvelope {
  const isError = error instanceof Error
  const message = isError
    ? `${error.name}: ${error.message}`
    : formatArg(error) || 'Unknown error'

  return {
    id: ambient.id,
    at: ambient.at,
    appBuild: ambient.appBuild,
    dataBuild: ambient.dataBuild,
    where: context.where,
    advice: context.advice ?? null,
    message,
    stack: isError ? (error.stack ?? null) : null,
    browser: ambient.browser,
    recent: ambient.recent,
    fatal: context.fatal,
  }
}

// The text the copy button puts on the clipboard. Plain text rather than JSON:
// it gets pasted into emails and ticket descriptions.
export function formatEnvelope(envelope: ErrorEnvelope): string {
  const out = [
    `${envelope.where} · ${envelope.at}`,
    `App     ${envelope.appBuild}`,
    `Data    ${envelope.dataBuild}`,
    `What    ${envelope.message}`,
  ]
  if (envelope.stack) {
    // Chrome repeats the message as the stack's first line and prefixes each
    // frame with "at"; Firefox and Safari do neither. Dropping the message
    // line rather than keeping "at" lines is what makes this work in all three.
    const frames = envelope.stack
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith(envelope.message))
      .slice(0, 6)
    out.push(...frames.map((frame, i) => `${i === 0 ? 'Stack  ' : '       '} ${frame}`))
  }
  out.push(`Browser ${envelope.browser}`)
  if (envelope.recent.length > 0) {
    out.push('Recent')
    out.push(...envelope.recent.map((line) => `  ${line}`))
  }
  return out.join('\n')
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

let nextId = 1

function ambient(): EnvelopeAmbient {
  return {
    id: nextId++,
    at: new Date().toISOString(),
    appBuild: APP_BUILD,
    // Read through the store rather than required: the failure being reported
    // may well be the manifest failing to load.
    dataBuild: dataManifest.current?.buildId ?? 'not loaded',
    browser: typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent,
    recent: logBuffer.snapshot(),
  }
}

export function reportError(error: unknown, context: ReportContext): ErrorEnvelope {
  const envelope = buildEnvelope(error, context, ambient())

  // The original object, not the formatted message: devtools makes a real
  // Error clickable through to its source line, and a string is not.
  suppressCapture = true
  console.error(`[error] ${envelope.where}:`, error)
  suppressCapture = false

  errorState.report(envelope)
  return envelope
}

// ---------------------------------------------------------------------------
// The nets
// ---------------------------------------------------------------------------

let handlersInstalled = false

// Installs two of the four nets. The other two are the database worker
// (services/db/sqliteClient) and the Svelte boundary in App.svelte.
export function installGlobalErrorHandlers(): void {
  if (handlersInstalled) return
  handlersInstalled = true
  installConsoleCapture()

  window.addEventListener('error', (event) => {
    // The same event fires when an <img> or <script> fails to load: no error
    // object, and the target is the element rather than the window.
    if (event.target && event.target !== window) return
    reportError(event.error ?? event.message, {
      where: 'unhandled error',
      fatal: true,
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    // Nobody awaited this, so the screen is still intact: a notice, not a stop.
    reportError(event.reason, {
      where: 'background task',
      fatal: false,
      advice: 'Something went wrong in the background. If the problem persists, try reloading the page.',
    })
  })
}

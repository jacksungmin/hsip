// What the two error surfaces render, per docs/07 "Error handling". Nothing
// here decides what a failure means — services/errorReporter does that and
// hands the finished envelope over.

// Type-only, so this does not create a runtime cycle with errorReporter.
import type { ErrorEnvelope } from '../services/errorReporter'

export type ErrorNotice = {
  envelope: ErrorEnvelope
  // A failing map tile can fire hundreds of times; one row that counts up
  // beats a hundred stacked toasts.
  repeats: number
}

// Four is about what fits on screen without covering the map.
const MAX_NOTICES = 4

// Dedup on what the user actually sees: advice if set, raw message otherwise.
function noticeKey(envelope: ErrorEnvelope): string {
  return `${envelope.where} ${envelope.advice ?? envelope.message}`
}

let fatal = $state<ErrorEnvelope | null>(null)
let notices = $state<ErrorNotice[]>([])

// Plain getters rather than the get() other containers use, matching
// dataManifest: these are read as values, never called with an argument.
export const errorState = {
  get fatal(): ErrorEnvelope | null {
    return fatal
  },

  get notices(): ErrorNotice[] {
    return notices
  },

  report(envelope: ErrorEnvelope): void {
    if (envelope.fatal) {
      // First one wins: whatever fails next is usually a consequence of this.
      if (!fatal) fatal = envelope
      return
    }

    const key = noticeKey(envelope)
    const existing = notices.find((notice) => noticeKey(notice.envelope) === key)
    if (existing) {
      // Keep the first envelope: its log lines are from when it started.
      notices = notices.map((notice) =>
        notice === existing ? { ...notice, repeats: notice.repeats + 1 } : notice,
      )
      return
    }

    notices = [...notices, { envelope, repeats: 1 }].slice(-MAX_NOTICES)
  },

  dismiss(id: number): void {
    notices = notices.filter((notice) => notice.envelope.id !== id)
  },

  clearNotices(): void {
    notices = []
  },

  // Tests and the dev debug menu. Nothing in the app clears a fatal failure:
  // the only way out of that screen is reloading the page.
  reset(): void {
    fatal = null
    notices = []
  },
}

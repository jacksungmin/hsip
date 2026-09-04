// Shape of a committed session fixture (src/dev/fixtures/*.json).
// Captured from a real session via Debug menu → "Capture session";
// see ./fixtures/README.md for the workflow.

import type { SessionSnapshot } from '../types'

export type SessionFixture = {
  meta: {
    description: string
    capturedAt: string // ISO timestamp of capture
    buildId: string // data build the snapshot's crashIds reference
    appVersion: string
  }
  snapshot: SessionSnapshot
}

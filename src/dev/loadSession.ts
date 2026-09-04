// Dev-only session loading, shared by the debug menu's file picker and
// its fixture-backed helpers. Fixtures are data-only (no UI state), so
// the loader first navigates the UI home — otherwise the workbench or
// site selection could keep pointing at a site the incoming session
// doesn't have. See ./fixtures/README.md.

import { applyAll } from '../state/sessionRegistry'
import { viewMode } from '../state/viewMode.svelte'
import { workbenchState } from '../state/workbenchState.svelte'
import { activeSite } from '../state/activeSite.svelte'
import { draftSiteState } from '../state/draftSiteState.svelte'
import { dataManifest } from '../state/dataManifest.svelte'
import type { SessionFixture } from './fixture'

export function isSessionFixture(v: unknown): v is SessionFixture {
  const f = v as SessionFixture
  return (
    typeof f === 'object' &&
    f !== null &&
    typeof f.meta?.buildId === 'string' &&
    typeof f.snapshot?.version === 'number' &&
    typeof f.snapshot?.stores === 'object' &&
    f.snapshot.stores !== null
  )
}

// UI state is not part of a session snapshot (registered stores are data
// stores only), so loading lands on a deterministic home instead:
// diagnosis view, workbench closed, nothing selected, no draft preview.
// Component-local UI state (an armed draw tool, panel flow steps) is not
// reachable from here; load from the home screen for best results.
function resetUiHome(): void {
  viewMode.set('diagnosis')
  workbenchState.close()
  activeSite.set(null)
  draftSiteState.clear()
  draftSiteState.setHiddenPart(null)
  draftSiteState.setSiteBufferPreview(null)
}

export function loadSession(fixture: SessionFixture, label: string): void {
  const live = dataManifest.current?.buildId
  if (live && fixture.meta.buildId !== live) {
    console.warn(
      `[debug] session "${label}" was captured against data build ${fixture.meta.buildId}; ` +
        `live build is ${live}. Its crashIds may not exist in the current db — ` +
        'recapture it (see src/dev/fixtures/README.md).',
    )
  }
  resetUiHome()
  applyAll(fixture.snapshot)
  console.log(`[debug] session "${label}" loaded`)
}

// Which overlay layers are switched on, and which of their legend classes.
// Seeded from config/overlays.yaml: `visible` sets the initial switch, and
// every class starts on so a freshly switched-on layer shows all its data.
//
// Deliberately not registered with sessionRegistry. Map styling is not
// persisted across sessions today (crash visibility is local component
// state), and overlays follow that rather than introducing a lone
// persisted styling store. See docs/06 OverlayState.

import * as overlayConfig from '../data/overlayConfig'
import { legendRows } from '../services/overlayStyle'

export type OverlayEntry = {
  on: boolean
  // Legend row keys currently switched on. Empty means the layer is on but
  // every class is filtered out, which draws nothing.
  classes: string[]
}

function seed(): Record<string, OverlayEntry> {
  const initial: Record<string, OverlayEntry> = {}
  for (const def of overlayConfig.all()) {
    initial[def.id] = {
      on: def.visible,
      classes: legendRows(def).map((row) => row.key),
    }
  }
  return initial
}

const entries = $state<Record<string, OverlayEntry>>(seed())

export const overlayState = {
  // Every configured layer is seeded, so callers holding a config def never
  // have to handle a missing entry.
  entry(id: string): OverlayEntry {
    return entries[id]
  },

  setVisible(id: string, on: boolean): void {
    entries[id].on = on
  },

  toggleClass(id: string, key: string): void {
    const entry = entries[id]
    entry.classes = entry.classes.includes(key)
      ? entry.classes.filter((k) => k !== key)
      : [...entry.classes, key]
  },
}

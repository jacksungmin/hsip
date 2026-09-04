// Overlay layer definitions, in the order they appear in the Layers panel.
// Loaded from build-generated JSON (source: config/overlays.yaml), which the
// build plugin has already validated and filled defaults into. Sync access only.

import rawData from './generated/overlays.json'
import type { OverlayLayerDef } from '../types'

const layers: OverlayLayerDef[] = rawData as OverlayLayerDef[]

export function all(): OverlayLayerDef[] {
  return layers
}

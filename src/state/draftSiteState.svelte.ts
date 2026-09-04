import type { LineString, Point, Polygon } from 'geojson'

export type DraftSiteValue = {
  type: 'roadway' | 'intersection'
  geometry: LineString | Point
  bufferFeet: number
  bufferPolygon: Polygon
  // When the draft previews an edit of a confirmed part (buffer edit or
  // redraw), these identify it so the buffer layer hides that part —
  // and only that part — while the preview is live.
  editingSiteId?: string
  editingPartId?: string
} | null

export type SiteBufferPreview = {
  siteId: string
  previews: Map<string, Polygon>
}

let current = $state<DraftSiteValue>(null)
let hiddenPart = $state<{ siteId: string; partId: string } | null>(null)
let bufferPreview = $state<SiteBufferPreview | null>(null)

export const draftSiteState = {
  get value(): DraftSiteValue {
    return current
  },
  set(v: DraftSiteValue) {
    current = v
  },
  clear() {
    current = null
  },
  // While a redraw is armed, the part being replaced is hidden from
  // the map even before any new geometry exists (so `value` is null
  // and can't carry the marker). Set on arm, cleared on cancel or
  // confirm — deliberately independent of clear(), which the preview
  // effect calls whenever the draft has no geometry.
  get hiddenPart(): { siteId: string; partId: string } | null {
    return hiddenPart
  },
  setHiddenPart(ref: { siteId: string; partId: string } | null) {
    hiddenPart = ref
  },
  get siteBufferPreview(): SiteBufferPreview | null {
    return bufferPreview
  },
  setSiteBufferPreview(v: SiteBufferPreview | null) {
    bufferPreview = v
  },
}

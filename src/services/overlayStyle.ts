// Turns one overlay style declaration from config/overlays.yaml into the three
// things the map needs: a MapLibre paint object, the legend rows shown in the
// Layers panel, and the filter that hides switched-off classes.
//
// All three read the same `categories` list, so a colour can never appear in
// the legend without also being painted and filterable. That is the whole
// reason the config declares classes explicitly instead of holding a raw
// MapLibre expression.
//
// The invariant only closes if callers seed their enabled-class set from
// `legendRows()` rather than inventing keys, since that is what ties a legend
// checkbox to the value `compileFilter` matches on.

import type { OverlayLayerDef, OverlayLegendRow } from '../types'

// Legend key for the optional `other` row, shaped so as not to collide with a
// real column value.
export const OTHER_KEY = '__other__'

// Zoom ramps own the awkward part of MapLibre styling so the config only has
// to say "thicker" or "thinner" via one multiplier.
// Flatter than a true linear-in-zoom ramp on purpose: a steep ramp makes a
// line hairline-thin when zoomed out and slab-thick when zoomed in. z12 is the
// anchor at 1, so the config's `width` multiplier keeps meaning what it did.
// MapLibre clamps outside the stop range, so z<8 holds 0.7 and z>16 holds 1.8.
const LINE_WIDTH_STOPS: [number, number][] = [
  [8, 0.7],
  [12, 1],
  [16, 1.8],
]

const POINT_RADIUS_STOPS: [number, number][] = [
  [8, 2],
  [12, 4],
  [16, 7],
]

// Unreachable when `other` is absent, because the filter drops unlisted
// values. Present because MapLibre requires a `match` fallback.
const UNLISTED_COLOR = '#cccccc'

export function maplibreType(draw: OverlayLayerDef['draw']): 'line' | 'circle' | 'fill' {
  if (draw === 'point') return 'circle'
  if (draw === 'polygon') return 'fill'
  return 'line'
}

function ramp(stops: [number, number][], multiplier: number): unknown[] {
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    ...stops.flatMap(([zoom, value]) => [zoom, value * multiplier]),
  ]
}

function colorExpression(style: OverlayLayerDef['style']): unknown {
  if (style.type === 'simple') return style.color
  return [
    'match',
    ['get', style.column],
    ...style.categories.flatMap((cat) => [cat.value, cat.color]),
    style.other?.color ?? UNLISTED_COLOR,
  ]
}

export function compilePaint(def: OverlayLayerDef): Record<string, unknown> {
  const color = colorExpression(def.style)

  if (def.draw === 'polygon') {
    return { 'fill-color': color, 'fill-opacity': def.opacity }
  }
  if (def.draw === 'point') {
    return {
      'circle-color': color,
      'circle-radius': ramp(POINT_RADIUS_STOPS, def.width),
      'circle-opacity': def.opacity,
    }
  }
  return {
    'line-color': color,
    'line-width': ramp(LINE_WIDTH_STOPS, def.width),
    'line-opacity': def.opacity,
  }
}

export function legendRows(def: OverlayLayerDef): OverlayLegendRow[] {
  // A simple style has nothing to switch, so it contributes no rows and the
  // Layers panel shows the layer as a bare on/off switch.
  if (def.style.type === 'simple') return []

  const rows: OverlayLegendRow[] = def.style.categories.map((cat) => ({
    key: String(cat.value),
    label: cat.label,
    color: cat.color,
  }))

  if (def.style.other) {
    rows.push({ key: OTHER_KEY, label: def.style.other.label, color: def.style.other.color })
  }
  return rows
}

function inValues(column: string, values: (string | number)[]): unknown[] {
  return ['in', ['get', column], ['literal', values]]
}

function classFilter(def: OverlayLayerDef, enabled: Set<string>): unknown[] | undefined {
  if (def.style.type === 'simple') return undefined

  const { column, categories, other } = def.style
  // Compare on the stringified key but filter on the original value, so a
  // numeric column like f_system stays numeric in the expression.
  const declared = categories.map((cat) => cat.value)
  const on = categories.filter((cat) => enabled.has(String(cat.value))).map((cat) => cat.value)

  if (other && enabled.has(OTHER_KEY)) {
    return ['any', inValues(column, on), ['!', inValues(column, declared)]]
  }
  return inValues(column, on)
}

export function compileFilter(
  def: OverlayLayerDef,
  enabled: Set<string>,
): unknown[] | undefined {
  const where = def.where
    ? ['==', ['get', def.where.column], def.where.equals]
    : undefined
  const classes = classFilter(def, enabled)

  if (where && classes) return ['all', where, classes]
  return where ?? classes
}

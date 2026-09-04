// Transient MapLibre report captures. One off-screen map instance is reused
// sequentially so overview, site, and site-part images share one loaded style.

import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import turfBbox from '@turf/bbox'
import type { Feature, FeatureCollection, Point } from 'geojson'
import { baseMapStyle, addSlotLayers } from '../map/baseMapStyle'
import { SEVERITY_MAP_COLORS } from '../data/severityMeta'
import type {
  CrashRecord,
  ReportAssets,
  ReportMapAsset,
  ReportPayload,
  Site,
  SitePart,
} from '../types'

const EMPTY_FEATURES: FeatureCollection = { type: 'FeatureCollection', features: [] }
const GEOMETRY_SOURCE = 'report-geometries'
const CRASH_SOURCE = 'report-crashes'
const CAPTURE_PIXEL_RATIO = 2
const CAPTURE_TIMEOUT_MS = 30_000

type CaptureSize = { width: number; height: number }

export type ReportMapJob = (
  | { kind: 'overview' }
  | { kind: 'site'; siteId: string }
  | { kind: 'site-part'; siteId: string; partId: string }
) & CaptureSize & { label: string }

export type ReportMapProgress = {
  completed: number
  total: number
  label: string
}

export type ReportMapData = {
  geometries: FeatureCollection
  crashes: FeatureCollection<Point>
  labels: Array<{ coordinates: [number, number]; text: string }>
  bounds: [number, number, number, number]
}

type CaptureReportMapsInput = {
  payload: ReportPayload
  crashesBySite: Record<string, CrashRecord[]>
  onProgress?: (progress: ReportMapProgress) => void
}

const CAPTURE_SIZES = {
  // The overview map owns a page of its own, so it is captured 5:6 (portrait)
  // to fill the printed column. Must stay in step with the aspect-ratio on
  // .report-overview-map img, or the raster is stretched to fit.
  overview: { width: 700, height: 840 },
  site: { width: 525, height: 394 },
  intersectionPart: { width: 300, height: 126 },
  roadwayPart: { width: 600, height: 300 },
} as const

export function createReportMapJobs(payload: ReportPayload): ReportMapJob[] {
  if (payload.sites.length === 0) return []

  const jobs: ReportMapJob[] = [
    { kind: 'overview', ...CAPTURE_SIZES.overview, label: 'Project overview map' },
  ]

  for (const [siteIndex, block] of payload.sites.entries()) {
    jobs.push({
      kind: 'site',
      siteId: block.site.id,
      ...CAPTURE_SIZES.site,
      label: `Site ${siteIndex + 1} overview map`,
    })

    if (block.site.parts.length <= 1) continue
    const size = block.site.type === 'intersection'
      ? CAPTURE_SIZES.intersectionPart
      : CAPTURE_SIZES.roadwayPart
    for (const [partIndex, part] of block.site.parts.entries()) {
      jobs.push({
        kind: 'site-part',
        siteId: block.site.id,
        partId: part.id,
        ...size,
        label: `Site ${siteIndex + 1}, part ${partIndex + 1} map`,
      })
    }
  }

  return jobs
}

function siteForJob(payload: ReportPayload, siteId: string): Site {
  const site = payload.sites.find((block) => block.site.id === siteId)?.site
  if (!site) throw new Error(`Report map references unknown site: ${siteId}`)
  return site
}

function partForJob(site: Site, partId: string): SitePart {
  const part = site.parts.find((candidate) => candidate.id === partId)
  if (!part) throw new Error(`Report map references unknown part: ${partId}`)
  return part
}

function bufferFeatures(sites: Site[]): Feature[] {
  return sites.flatMap((site, siteIndex) =>
    site.parts.map((part) => ({
      type: 'Feature' as const,
      geometry: part.bufferedGeometry,
      properties: { kind: 'buffer', siteIndex: siteIndex + 1 },
    })),
  )
}

function boundsForParts(parts: SitePart[]): [number, number, number, number] {
  if (parts.length === 0) throw new Error('Cannot capture a report map without site parts')
  const collection: FeatureCollection = {
    type: 'FeatureCollection',
    features: parts.map((part) => ({
      type: 'Feature',
      geometry: part.bufferedGeometry,
      properties: {},
    })),
  }
  return turfBbox(collection) as [number, number, number, number]
}

function labelForPart(part: SitePart, siteIndex: number) {
  const [west, south, east, north] = boundsForParts([part])
  return {
    coordinates: [(west + east) / 2, (south + north) / 2] as [number, number],
    text: `S${siteIndex + 1}`,
  }
}

function crashFeatures(crashes: CrashRecord[]): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: crashes.map((crash) => ({
      type: 'Feature',
      geometry: crash.location,
      properties: { severity: crash.severity },
    })),
  }
}

export function createReportMapData(
  payload: ReportPayload,
  crashesBySite: Record<string, CrashRecord[]>,
  job: ReportMapJob,
): ReportMapData {
  if (job.kind === 'overview') {
    const sites = payload.sites.map((block) => block.site)
    return {
      geometries: { type: 'FeatureCollection', features: bufferFeatures(sites) },
      crashes: { type: 'FeatureCollection', features: [] },
      labels: sites.flatMap((site, siteIndex) =>
        site.parts.map((part) => labelForPart(part, siteIndex)),
      ),
      bounds: boundsForParts(sites.flatMap((site) => site.parts)),
    }
  }

  const site = siteForJob(payload, job.siteId)
  const siteCrashes = crashesBySite[site.id]
  if (!siteCrashes) throw new Error(`Report map has no crash rows for site: ${site.id}`)

  if (job.kind === 'site') {
    return {
      geometries: { type: 'FeatureCollection', features: bufferFeatures([site]) },
      crashes: crashFeatures(siteCrashes),
      labels: [],
      bounds: boundsForParts(site.parts),
    }
  }

  const part = partForJob(site, job.partId)
  const partCrashIds = new Set(part.crashes.map((crash) => crash.id))
  return {
    geometries: { type: 'FeatureCollection', features: bufferFeatures([{ ...site, parts: [part] }]) },
    crashes: crashFeatures(siteCrashes.filter((crash) => partCrashIds.has(crash.id))),
    labels: [],
    bounds: boundsForParts([part]),
  }
}

function createCaptureContainer(initialSize: CaptureSize): HTMLDivElement {
  const container = document.createElement('div')
  Object.assign(container.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: `${initialSize.width}px`,
    height: `${initialSize.height}px`,
    background: '#ffffff',
    pointerEvents: 'none',
  })
  container.setAttribute('aria-hidden', 'true')
  document.body.appendChild(container)
  return container
}

function waitForMapEvent(map: maplibregl.Map, event: 'load' | 'idle'): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      map.off(event, handleEvent)
      reject(new Error(`Timed out waiting for report map ${event}`))
    }, CAPTURE_TIMEOUT_MS)

    function handleEvent() {
      window.clearTimeout(timeout)
      resolve()
    }

    map.once(event, handleEvent)
  })
}

function addReportLayers(map: maplibregl.Map): void {
  map.addSource(GEOMETRY_SOURCE, { type: 'geojson', data: EMPTY_FEATURES })
  map.addSource(CRASH_SOURCE, { type: 'geojson', data: EMPTY_FEATURES })

  map.addLayer({
    id: 'report-buffer-fill',
    type: 'fill',
    source: GEOMETRY_SOURCE,
    filter: ['==', ['get', 'kind'], 'buffer'],
    paint: { 'fill-color': '#2865a7', 'fill-opacity': 0.14 },
  }, 'slot-site')
  map.addLayer({
    id: 'report-buffer-line',
    type: 'line',
    source: GEOMETRY_SOURCE,
    filter: ['==', ['get', 'kind'], 'buffer'],
    paint: {
      'line-color': '#2865a7',
      'line-width': 2,
      'line-dasharray': [3, 2],
    },
  }, 'slot-site')
  map.addLayer({
    id: 'report-crash-points',
    type: 'circle',
    source: CRASH_SOURCE,
    paint: {
      'circle-radius': 5,
      'circle-color': [
        'match', ['get', 'severity'],
        'K', SEVERITY_MAP_COLORS.K,
        'A', SEVERITY_MAP_COLORS.A,
        'B', SEVERITY_MAP_COLORS.B,
        SEVERITY_MAP_COLORS.B,
      ],
      'circle-opacity': 0.9,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1,
    },
  }, 'slot-interaction')
}

function setCaptureSize(
  container: HTMLDivElement,
  map: maplibregl.Map,
  size: CaptureSize,
): void {
  container.style.width = `${size.width}px`
  container.style.height = `${size.height}px`
  map.resize()
}

function updateMapData(map: maplibregl.Map, data: ReportMapData): void {
  const geometrySource = map.getSource(GEOMETRY_SOURCE) as maplibregl.GeoJSONSource
  const crashSource = map.getSource(CRASH_SOURCE) as maplibregl.GeoJSONSource
  geometrySource.setData(data.geometries)
  crashSource.setData(data.crashes)
}

function drawOverviewLabels(
  map: maplibregl.Map,
  labels: ReportMapData['labels'],
): HTMLCanvasElement {
  const source = map.getCanvas()
  if (labels.length === 0) return source

  const output = document.createElement('canvas')
  output.width = source.width
  output.height = source.height
  const context = output.getContext('2d')
  if (!context) throw new Error('Unable to create report map label canvas')
  context.drawImage(source, 0, 0)

  const pixelRatio = map.getPixelRatio()
  for (const label of labels) {
    const point = map.project(label.coordinates)
    const x = (point.x + 6) * pixelRatio
    const y = (point.y - 6) * pixelRatio

    context.font = `700 ${9 * pixelRatio}px Inter, sans-serif`
    context.textAlign = 'left'
    context.textBaseline = 'bottom'
    context.lineJoin = 'round'
    context.lineWidth = 3 * pixelRatio
    context.strokeStyle = 'rgba(255,255,255,0.95)'
    context.strokeText(label.text, x, y)
    context.fillStyle = '#025773'
    context.fillText(label.text, x, y)
  }

  return output
}

function haversineMeters(a: maplibregl.LngLat, b: maplibregl.LngLat): number {
  const radians = Math.PI / 180
  const lat1 = a.lat * radians
  const lat2 = b.lat * radians
  const deltaLat = (b.lat - a.lat) * radians
  const deltaLng = (b.lng - a.lng) * radians
  const h = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2
  return 2 * 6_371_008.8 * Math.asin(Math.sqrt(h))
}

function niceFloor(value: number): number {
  if (value <= 0) return 0
  const magnitude = 10 ** Math.floor(Math.log10(value))
  for (const factor of [5, 2, 1]) {
    const candidate = factor * magnitude
    if (candidate <= value) return candidate
  }
  return magnitude
}

function scaleForMap(map: maplibregl.Map, width: number, height: number) {
  const targetPixels = Math.min(100, width * 0.28)
  const start = map.unproject([20, height / 2])
  const end = map.unproject([20 + targetPixels, height / 2])
  const maxMeters = haversineMeters(start, end)

  let scaleMeters: number
  let scaleLabel: string
  if (maxMeters >= 1609.344) {
    const miles = niceFloor(maxMeters / 1609.344)
    scaleMeters = miles * 1609.344
    scaleLabel = `${miles.toLocaleString('en-US')} mi`
  } else {
    const feet = niceFloor(maxMeters * 3.28084)
    scaleMeters = feet / 3.28084
    scaleLabel = `${feet.toLocaleString('en-US')} ft`
  }

  return {
    scaleLabel,
    scaleWidthPercent: Math.min(100, (scaleMeters / maxMeters) * (targetPixels / width) * 100),
  }
}

function captureAsset(
  map: maplibregl.Map,
  job: ReportMapJob,
  labels: ReportMapData['labels'],
): ReportMapAsset {
  const canvas = drawOverviewLabels(map, labels)
  const scale = scaleForMap(map, job.width, job.height)
  try {
    return {
      src: canvas.toDataURL('image/png'),
      pixelWidth: canvas.width,
      pixelHeight: canvas.height,
      ...scale,
    }
  } catch (error) {
    throw new Error('Unable to capture report map canvas. A map tile may not allow cross-origin export.', {
      cause: error,
    })
  }
}

function assignAsset(assets: ReportAssets, job: ReportMapJob, asset: ReportMapAsset): void {
  if (job.kind === 'overview') {
    assets.overviewMap = asset
    return
  }
  if (job.kind === 'site') {
    assets.siteMaps[job.siteId] = asset
    return
  }
  assets.partMaps[job.siteId] ??= {}
  assets.partMaps[job.siteId][job.partId] = asset
}

export async function captureReportMaps({
  payload,
  crashesBySite,
  onProgress,
}: CaptureReportMapsInput): Promise<ReportAssets> {
  const jobs = createReportMapJobs(payload)
  const assets: ReportAssets = { overviewMap: null, siteMaps: {}, partMaps: {} }
  if (jobs.length === 0) return assets

  const container = createCaptureContainer(jobs[0])
  const map = new maplibregl.Map({
    container,
    style: baseMapStyle(),
    center: [-95.37, 29.76],
    zoom: 8,
    interactive: false,
    attributionControl: false,
    trackResize: false,
    fadeDuration: 0,
    pixelRatio: CAPTURE_PIXEL_RATIO,
    canvasContextAttributes: { preserveDrawingBuffer: true },
  })

  try {
    await waitForMapEvent(map, 'load')
    addSlotLayers(map)
    addReportLayers(map)

    for (const [jobIndex, job] of jobs.entries()) {
      onProgress?.({ completed: jobIndex, total: jobs.length, label: job.label })
      const data = createReportMapData(payload, crashesBySite, job)
      const idle = waitForMapEvent(map, 'idle')
      setCaptureSize(container, map, job)
      updateMapData(map, data)
      const [west, south, east, north] = data.bounds
      map.fitBounds([[west, south], [east, north]], {
        padding: job.kind === 'site-part' ? 22 : 34,
        duration: 0,
      })
      map.triggerRepaint()
      await idle
      assignAsset(assets, job, captureAsset(map, job, data.labels))
      onProgress?.({ completed: jobIndex + 1, total: jobs.length, label: job.label })
    }

    return assets
  } finally {
    map.remove()
    container.remove()
  }
}

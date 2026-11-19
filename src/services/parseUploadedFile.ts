// Parse uploaded .geojson or .shp (zipped) files into site geometries.
import type { Point, LineString, Feature, FeatureCollection, GeoJsonProperties } from 'geojson'
import proj4 from 'proj4'
import JSZip from 'jszip'
import * as shapefile from 'shapefile'
import { PROJECTIONS } from '../data/projections'
import { NAD27_SHIFT } from '../data/nad27Shift'

export type SiteType = 'roadway' | 'intersection'

export type ParsedFeature = {
  geometry: Point | LineString
  name: string | null
  properties: Record<string, unknown>
}

export type ParseResult = {
  features: ParsedFeature[]
  columns: string[]
  // The coordinate system the file was converted from (e.g. "NAD83 / Texas
  // South Central (ftUS)"), or null when it was already longitude/latitude.
  crs: string | null
  // True when that system is on NAD27, so the datum shift was applied too.
  nad27: boolean
}

export type ParseErrorType =
  | 'invalid-format'
  | 'no-features'
  | 'wrong-geometry'
  | 'mixed-geometry'
  | 'file-too-large'
  | 'unsupported-crs'
  | 'not-lon-lat'

export type ParseError = {
  type: ParseErrorType
  message: string
}

type ParseReturn =
  | { ok: true; result: ParseResult }
  | { ok: false; error: ParseError }

const MAX_FILE_SIZE = 10 * 1024 * 1024

function err(type: ParseErrorType, message: string): ParseReturn {
  return { ok: false, error: { type, message } }
}

type SingleGeomType = 'Point' | 'LineString'
type AcceptedGeomType = SingleGeomType | 'MultiPoint' | 'MultiLineString'

const EXPECTED_TYPES: Record<SiteType, { single: SingleGeomType; multi: AcceptedGeomType }> = {
  intersection: { single: 'Point', multi: 'MultiPoint' },
  roadway: { single: 'LineString', multi: 'MultiLineString' },
}

function explodeMulti(
  geometry: { type: string; coordinates: unknown },
  singleType: SingleGeomType
): Array<Point | LineString> {
  const coords = geometry.coordinates as number[][] | number[][][]
  return coords.map((c) => ({ type: singleType, coordinates: c }) as Point | LineString)
}

function mergeFeatureId(f: Feature): Record<string, unknown> {
  const props = (f.properties ?? {}) as Record<string, unknown>
  if (f.id != null && !('id' in props)) {
    return { id: f.id, ...props }
  }
  return props
}

function extractColumns(features: Feature[]): string[] {
  const keys = new Set<string>()
  for (const f of features) {
    const props = mergeFeatureId(f)
    for (const k of Object.keys(props)) keys.add(k)
  }
  return [...keys].sort()
}

function getDefaultName(properties: GeoJsonProperties): string | null {
  if (!properties) return null
  const candidates = ['name', 'Name', 'NAME', 'label', 'Label', 'LABEL']
  for (const c of candidates) {
    if (properties[c] != null) return String(properties[c])
  }
  return null
}

// A coordinate system an upload is converted from: a proj4 definition or a
// shapefile's .prj WKT, a readable name, and whether it is on NAD27.
export type SourceCrs = { def: string; label: string; nad27: boolean }

const NAD27_GEOGRAPHIC = '+proj=longlat +ellps=clrk66 +no_defs'

// NAD27 positions in the H-GAC area sit 28-41 m from NAD83/WGS 84. proj4js
// can only apply that datum shift with NOAA's grid files, which it does not
// have, so NAD27 input is projected to NAD27 longitude/latitude and shifted
// here from a grid sampled from NOAA's NADCON grid (data/nad27Shift.ts,
// bilinear). Null outside the grid, which covers the region with a margin.
export function nad27ToNad83(lon: number, lat: number): [number, number] | null {
  const g = NAD27_SHIFT
  const fx = (lon - g.west) / g.step
  const fy = (lat - g.south) / g.step
  if (!(fx >= 0 && fy >= 0 && fx <= g.cols - 1 && fy <= g.rows - 1)) return null
  const c = Math.min(Math.floor(fx), g.cols - 2)
  const r = Math.min(Math.floor(fy), g.rows - 2)
  const tx = fx - c
  const ty = fy - r
  const at = (a: number[], rr: number, cc: number) => a[rr * g.cols + cc]
  const bilinear = (a: number[]) =>
    (at(a, r, c) * (1 - tx) * (1 - ty) + at(a, r, c + 1) * tx * (1 - ty) +
      at(a, r + 1, c) * (1 - tx) * ty + at(a, r + 1, c + 1) * tx * ty) / g.scale
  return [lon + bilinear(g.dlon), lat + bilinear(g.dlat)]
}

function toWgs84(coords: number[], src: SourceCrs): number[] {
  if (src.nad27) {
    const [lon, lat] = proj4(src.def, NAD27_GEOGRAPHIC, [coords[0], coords[1]])
    // Outside the grid the point is far outside the region anyway; the
    // dialog's outside-region warning covers it.
    return nad27ToNad83(lon, lat) ?? [lon, lat]
  }
  return proj4(src.def, 'EPSG:4326', [coords[0], coords[1]])
}

function reprojectGeometry(geom: Point | LineString, src: SourceCrs): Point | LineString {
  if (geom.type === 'Point') {
    return { type: 'Point', coordinates: toWgs84(geom.coordinates, src) }
  }
  return {
    type: 'LineString',
    coordinates: (geom.coordinates as number[][]).map((c) => toWgs84(c, src)),
  }
}

// Every coordinate pair, for the longitude/latitude check.
function eachPosition(geom: Point | LineString): number[][] {
  return geom.type === 'Point' ? [geom.coordinates] : (geom.coordinates as number[][])
}

// A shapefile's .prj: its name for display, and whether it is on NAD27.
export function crsFromPrj(wkt: string): SourceCrs {
  const name = wkt.match(/^\s*(?:PROJCS|GEOGCS|PROJCRS|GEOGCRS)\["([^"]+)"/)?.[1] ?? "the file's coordinate system"
  return { def: wkt, label: name.replace(/_/g, ' '), nad27: /1927|NAD27|NAD_27/i.test(wkt) }
}

// The GeoJSON (2008) "crs" member, which RFC 7946 dropped but ArcGIS, QGIS
// and GDAL still write for data not in WGS 84:
//   {"type":"name","properties":{"name":"urn:ogc:def:crs:EPSG::2278"}}
//   {"type":"EPSG","properties":{"code":2278}}            (older form)
// Longitude/latitude when absent, CRS84 or EPSG:4326; otherwise a known
// system, or an unknown one by name.
export type GeoJsonCrs =
  | { kind: 'lonlat' }
  | { kind: 'known'; src: SourceCrs }
  | { kind: 'unknown'; name: string }

export function crsFromGeoJSON(obj: Record<string, unknown>): GeoJsonCrs {
  const crs = obj.crs as { properties?: { name?: unknown; code?: unknown } } | undefined
  if (!crs || typeof crs !== 'object') return { kind: 'lonlat' }
  const props = crs.properties ?? {}
  const raw = props.name ?? (props.code != null ? `EPSG:${String(props.code)}` : null)
  if (raw == null) return { kind: 'lonlat' }
  const name = String(raw)
  if (/CRS84$/i.test(name)) return { kind: 'lonlat' }
  const code = name.match(/EPSG:{1,2}(?:[\d.]*:)?(\d+)$/i)?.[1]
  if (code === '4326') return { kind: 'lonlat' }
  const known = code ? PROJECTIONS[code] : undefined
  if (known) {
    return { kind: 'known', src: { def: known.proj4, label: `${known.name} (EPSG:${code})`, nad27: known.nad27 } }
  }
  return { kind: 'unknown', name: code ? `EPSG:${code}` : name }
}

function processFeatures(
  rawFeatures: Feature[],
  expectedType: SiteType,
  source: SourceCrs | null,
): ParseReturn {
  if (rawFeatures.length === 0) {
    return err('no-features', 'File contains no features.')
  }

  const { single, multi } = EXPECTED_TYPES[expectedType]
  const parsedFeatures: ParsedFeature[] = []

  for (const f of rawFeatures) {
    const geomType = f.geometry?.type
    if (!geomType) {
      return err('invalid-format', 'A feature in the file is missing its geometry.')
    }

    const props = mergeFeatureId(f)

    if (geomType === single) {
      parsedFeatures.push({
        geometry: f.geometry as Point | LineString,
        name: getDefaultName(f.properties),
        properties: props,
      })
    } else if (geomType === multi) {
      const exploded = explodeMulti(f.geometry, single)
      for (const g of exploded) {
        parsedFeatures.push({ geometry: g, name: getDefaultName(f.properties), properties: props })
      }
    } else if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
      const expected = expectedType === 'roadway' ? 'line' : 'point'
      return err('wrong-geometry', `This file contains polygon features. ${expectedType === 'roadway' ? 'Roadway' : 'Intersection'} sites require ${expected} features.`)
    } else {
      const otherSingle = expectedType === 'roadway' ? 'Point' : 'LineString'
      if (geomType === otherSingle || geomType === `Multi${otherSingle}`) {
        const found = expectedType === 'roadway' ? 'point' : 'line'
        const expected = expectedType === 'roadway' ? 'line' : 'point'
        const otherType = expectedType === 'roadway' ? 'Intersection' : 'Roadway'
        return err(
          'mixed-geometry',
          `This file contains ${found} features. ${expectedType === 'roadway' ? 'Roadway' : 'Intersection'} sites require ${expected} features. ` +
          `Try uploading under ${otherType} instead, or use a file with ${expected} geometries.`,
        )
      }
      return err('wrong-geometry', `Unsupported geometry type: ${geomType}.`)
    }
  }

  if (source) {
    for (const pf of parsedFeatures) {
      pf.geometry = reprojectGeometry(pf.geometry, source)
    }
  }

  // Coordinates that are not longitude/latitude would otherwise be read as
  // degrees and put the sites somewhere else on the globe with no crashes:
  // State Plane feet, for example, lands in China. Stop with a way forward.
  for (const pf of parsedFeatures) {
    const bad = eachPosition(pf.geometry).find(
      (p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90,
    )
    if (bad) {
      const fmt = (v: number) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })
      return err(
        'not-lon-lat',
        `The coordinates in this file are not longitude/latitude (for example ${fmt(bad[0])}, ${fmt(bad[1])}), ` +
          'and the file does not say which coordinate system they are in. Export it in WGS 84 (EPSG:4326), ' +
          'or upload it as a zipped shapefile that includes its .prj file.',
      )
    }
  }

  return {
    ok: true,
    result: {
      features: parsedFeatures,
      columns: extractColumns(rawFeatures),
      crs: source?.label ?? null,
      nad27: source?.nad27 ?? false,
    },
  }
}

function parseGeoJSON(text: string, expectedType: SiteType): ParseReturn {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return err('invalid-format', 'File is not valid JSON.')
  }

  const obj = parsed as Record<string, unknown>

  const crs = crsFromGeoJSON(obj)
  if (crs.kind === 'unknown') {
    return err(
      'unsupported-crs',
      `This file is in ${crs.name}, which the tool cannot convert. Export it in WGS 84 (EPSG:4326), ` +
        'or upload it as a zipped shapefile that includes its .prj file.',
    )
  }
  const source = crs.kind === 'known' ? crs.src : null

  if (obj.type === 'FeatureCollection') {
    const fc = obj as unknown as FeatureCollection
    return processFeatures(fc.features, expectedType, source)
  }

  if (obj.type === 'Feature') {
    return processFeatures([obj as unknown as Feature], expectedType, source)
  }

  return err('invalid-format', 'File is not a recognized GeoJSON format.')
}

async function parseShapefileZip(file: File, expectedType: SiteType): Promise<ParseReturn> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer())
  } catch {
    return err('invalid-format', 'File is not a valid ZIP archive.')
  }

  const files = Object.keys(zip.files)
  const shpFile = files.find((f) => f.toLowerCase().endsWith('.shp'))
  const dbfFile = files.find((f) => f.toLowerCase().endsWith('.dbf'))
  const prjFile = files.find((f) => f.toLowerCase().endsWith('.prj'))

  if (!shpFile) {
    return err('invalid-format', 'ZIP does not contain a .shp file.')
  }

  const shpBuffer = await zip.files[shpFile].async('arraybuffer')
  const dbfBuffer = dbfFile ? await zip.files[dbfFile].async('arraybuffer') : undefined

  let prjContent: string | null = null
  if (prjFile) {
    prjContent = await zip.files[prjFile].async('string')
  }

  let fc: FeatureCollection
  try {
    fc = await shapefile.read(shpBuffer, dbfBuffer) as FeatureCollection
  } catch (e) {
    return err('invalid-format', `Could not read the shapefile: ${(e as Error).message}`)
  }

  let source: SourceCrs | null = null
  // A .prj that is plain WGS 84 longitude/latitude needs no conversion (and
  // no "converted from WGS 84 to WGS 84" note).
  const plainWgs84 = prjContent && /^\s*GEOGCS\["(GCS_WGS_1984|WGS 84)"/.test(prjContent)
  if (prjContent && !plainWgs84) {
    source = crsFromPrj(prjContent)
    try {
      proj4(source.def, 'EPSG:4326')
    } catch {
      return err(
        'unsupported-crs',
        `This shapefile's coordinate system (${source.label}) cannot be converted. Export it in WGS 84 (EPSG:4326).`,
      )
    }
  }
  return processFeatures(fc.features, expectedType, source)
}

export async function parseUploadedFile(
  file: File,
  expectedType: SiteType,
): Promise<ParseReturn> {
  if (file.size > MAX_FILE_SIZE) {
    return err('file-too-large', `File exceeds the 10 MB limit (${(file.size / 1024 / 1024).toFixed(1)} MB).`)
  }

  const name = file.name.toLowerCase()

  if (name.endsWith('.geojson') || name.endsWith('.json')) {
    const text = await file.text()
    return parseGeoJSON(text, expectedType)
  }

  if (name.endsWith('.zip')) {
    return parseShapefileZip(file, expectedType)
  }

  return err('invalid-format', 'Unsupported file type. Use .geojson, .json, or .zip (shapefile).')
}

export function applyNameColumn(features: ParsedFeature[], column: string): ParsedFeature[] {
  return features.map((pf) => {
    const val = pf.properties[column]
    return { ...pf, name: val != null ? String(val) : pf.name }
  })
}

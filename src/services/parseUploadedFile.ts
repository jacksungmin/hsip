// Parse uploaded .geojson or .shp (zipped) files into site geometries.
import type { Point, LineString, Feature, FeatureCollection, GeoJsonProperties } from 'geojson'
import proj4 from 'proj4'
import JSZip from 'jszip'
import * as shapefile from 'shapefile'

export type SiteType = 'roadway' | 'intersection'

export type ParsedFeature = {
  geometry: Point | LineString
  name: string | null
  properties: Record<string, unknown>
}

export type ParseResult = {
  features: ParsedFeature[]
  columns: string[]
  crs: string | null
}

export type ParseErrorType =
  | 'invalid-format'
  | 'no-features'
  | 'wrong-geometry'
  | 'mixed-geometry'
  | 'file-too-large'

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

function reprojectCoords(coords: number[], prjContent: string): number[] {
  return proj4(prjContent, 'EPSG:4326', [coords[0], coords[1]])
}

function reprojectGeometry(geom: Point | LineString, prjContent: string): Point | LineString {
  if (geom.type === 'Point') {
    return { type: 'Point', coordinates: reprojectCoords(geom.coordinates, prjContent) }
  }
  return {
    type: 'LineString',
    coordinates: (geom.coordinates as number[][]).map((c) => reprojectCoords(c, prjContent)),
  }
}

function processFeatures(
  rawFeatures: Feature[],
  expectedType: SiteType,
  prjContent: string | null,
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

  if (prjContent) {
    for (const pf of parsedFeatures) {
      pf.geometry = reprojectGeometry(pf.geometry, prjContent)
    }
  }

  return {
    ok: true,
    result: {
      features: parsedFeatures,
      columns: extractColumns(rawFeatures),
      crs: prjContent,
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

  if (obj.type === 'FeatureCollection') {
    const fc = obj as unknown as FeatureCollection
    return processFeatures(fc.features, expectedType, null)
  }

  if (obj.type === 'Feature') {
    return processFeatures([obj as unknown as Feature], expectedType, null)
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

  return processFeatures(fc.features, expectedType, prjContent)
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

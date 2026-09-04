// Generic ESRI FeatureServer query helper.
//
// App-unused since the migration to pre-built static artifacts:
// runtime data comes from tools/data-build outputs. Kept for future
// optional ESRI overlay layers (docs/07, ESRI REST section).
//
// Asks for f=geojson so the server emits standard GeoJSON
// (RFC 7946) directly. ESRI handles ring orientation and
// MultiPolygon assembly server-side. No client-side ring grouping
// or geometry conversion needed.
//
// CRS: outSR=4326 pins WGS84 in the response. Stores always hold
// WGS84 per docs/07 "CRS handling".

import type { Feature, FeatureCollection, Geometry } from 'geojson'

// ESRI extends the GeoJSON FeatureCollection with a top-level
// properties bag carrying exceededTransferLimit. Standard FeatureCollection
// has no such field, so this is an ESRI-specific shape.
type EsriGeoJsonResponse = FeatureCollection & {
  properties?: { exceededTransferLimit?: boolean }
  error?: { code?: number; message: string }
}

export type QueryOptions = {
  where?: string
  outFields?: string[]
  returnGeometry?: boolean
  pageSize?: number
  onPageComplete?: (completed: number, totalPages: number) => void
}

export async function fetchLayerLastEditDate(layerUrl: string): Promise<number | null> {
  const url = `${layerUrl}?f=json`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `ESRI layer metadata fetch failed: ${response.status} ${response.statusText} (${url})`,
    )
  }
  const data = (await response.json()) as {
    editingInfo?: { lastEditDate?: number }
    error?: { message: string }
  }
  if (data.error) {
    throw new Error(`ESRI layer metadata error: ${data.error.message}`)
  }
  return data.editingInfo?.lastEditDate ?? null
}

async function queryCount(layerUrl: string, where: string): Promise<number> {
  const params = new URLSearchParams({
    where,
    returnCountOnly: 'true',
    f: 'json',
  })
  const url = `${layerUrl}/query?${params}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `ESRI count query failed: ${response.status} ${response.statusText} (${url})`,
    )
  }
  const data = (await response.json()) as { count?: number; error?: { message: string } }
  if (data.error) {
    throw new Error(`ESRI count query error: ${data.error.message}`)
  }
  if (typeof data.count !== 'number') {
    throw new Error(`ESRI count query returned no count (${url})`)
  }
  return data.count
}

async function fetchPage<G extends Geometry>(
  layerUrl: string,
  where: string,
  outFields: string[],
  returnGeometry: boolean,
  pageSize: number,
  resultOffset: number,
): Promise<Feature<G>[]> {
  const params = new URLSearchParams({
    where,
    outFields: outFields.join(','),
    returnGeometry: String(returnGeometry),
    outSR: '4326',
    f: 'geojson',
    resultOffset: String(resultOffset),
    resultRecordCount: String(pageSize),
  })

  const url = `${layerUrl}/query?${params}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `ESRI query failed: ${response.status} ${response.statusText} (${url})`,
    )
  }
  const data = (await response.json()) as EsriGeoJsonResponse
  if (data.error) {
    throw new Error(`ESRI query error: ${data.error.message}`)
  }
  return data.features as Feature<G>[]
}

// Pulls every feature matching the query. Fetches the count first,
// then fires all page requests in parallel. Page size of 2000
// matches the FeatureServer maxRecordCount default.
//
// Generic G narrows the returned geometry type so callers consume
// `Feature<Polygon | MultiPolygon>[]` (or whatever shape they expect)
// without casting.
export async function queryAllFeatures<G extends Geometry = Geometry>(
  layerUrl: string,
  options: QueryOptions = {},
): Promise<Feature<G>[]> {
  const {
    where = '1=1',
    outFields = ['*'],
    returnGeometry = true,
    pageSize = 2000,
    onPageComplete,
  } = options

  const total = await queryCount(layerUrl, where)
  if (total === 0) return []

  const offsets: number[] = []
  for (let offset = 0; offset < total; offset += pageSize) {
    offsets.push(offset)
  }

  let completed = 0
  const pages = await Promise.all(
    offsets.map(async (offset) => {
      const page = await fetchPage<G>(layerUrl, where, outFields, returnGeometry, pageSize, offset)
      completed++
      onPageComplete?.(completed, offsets.length)
      return page
    }),
  )

  return pages.flat()
}

// Tests for GeoJSON/shapefile upload parsing: geometry validation, explosion,
// name extraction, error cases. Covers the parseUploadedFile contract.
import { describe, it, expect } from 'vitest'
import { parseUploadedFile, applyNameColumn } from './parseUploadedFile'
import type { FeatureCollection, Feature } from 'geojson'

function geojsonFile(data: unknown, name = 'test.geojson'): File {
  const text = JSON.stringify(data)
  return new File([text], name, { type: 'application/json' })
}

function fc(features: Feature[]): FeatureCollection {
  return { type: 'FeatureCollection', features }
}

const POINT_FEATURE: Feature = {
  type: 'Feature',
  properties: { Name: 'Intersection A', id: 1 },
  geometry: { type: 'Point', coordinates: [-95.36, 29.76] },
}

const LINE_FEATURES: Feature[] = [
  {
    type: 'Feature',
    properties: { label: 'Segment 1' },
    geometry: { type: 'LineString', coordinates: [[-95.36, 29.76], [-95.37, 29.77]] },
  },
  {
    type: 'Feature',
    properties: { label: 'Segment 2' },
    geometry: { type: 'LineString', coordinates: [[-95.38, 29.78], [-95.39, 29.79]] },
  },
  {
    type: 'Feature',
    properties: { label: 'Segment 3' },
    geometry: { type: 'LineString', coordinates: [[-95.40, 29.80], [-95.41, 29.81]] },
  },
]

describe('parseUploadedFile', () => {
  it('parses a single Point as intersection', async () => {
    const result = await parseUploadedFile(geojsonFile(fc([POINT_FEATURE])), 'intersection')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.result.features).toHaveLength(1)
    expect(result.result.features[0].geometry.type).toBe('Point')
    expect(result.result.features[0].name).toBe('Intersection A')
  })

  it('parses 3 LineStrings as roadway', async () => {
    const result = await parseUploadedFile(geojsonFile(fc(LINE_FEATURES)), 'roadway')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.result.features).toHaveLength(3)
    for (const f of result.result.features) {
      expect(f.geometry.type).toBe('LineString')
    }
  })

  it('explodes MultiLineString to individual LineStrings', async () => {
    const multi: Feature = {
      type: 'Feature',
      properties: { name: 'Corridor' },
      geometry: {
        type: 'MultiLineString',
        coordinates: [
          [[-95.36, 29.76], [-95.37, 29.77]],
          [[-95.38, 29.78], [-95.39, 29.79]],
          [[-95.40, 29.80], [-95.41, 29.81]],
        ],
      },
    }
    const result = await parseUploadedFile(geojsonFile(fc([multi])), 'roadway')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.result.features).toHaveLength(3)
    for (const f of result.result.features) {
      expect(f.geometry.type).toBe('LineString')
      expect(f.name).toBe('Corridor')
    }
  })

  it('explodes MultiPoint to individual Points', async () => {
    const multi: Feature = {
      type: 'Feature',
      properties: { NAME: 'Cluster' },
      geometry: {
        type: 'MultiPoint',
        coordinates: [[-95.36, 29.76], [-95.37, 29.77]],
      },
    }
    const result = await parseUploadedFile(geojsonFile(fc([multi])), 'intersection')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.result.features).toHaveLength(2)
    for (const f of result.result.features) {
      expect(f.geometry.type).toBe('Point')
      expect(f.name).toBe('Cluster')
    }
  })

  it('rejects Polygon geometry', async () => {
    const poly: Feature = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [[[-95.36, 29.76], [-95.37, 29.77], [-95.38, 29.76], [-95.36, 29.76]]],
      },
    }
    const result = await parseUploadedFile(geojsonFile(fc([poly])), 'roadway')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.type).toBe('wrong-geometry')
  })

  it('rejects mixed Point + LineString', async () => {
    const mixed: Feature[] = [
      POINT_FEATURE,
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: [[-95.36, 29.76], [-95.37, 29.77]] },
      },
    ]
    const result = await parseUploadedFile(geojsonFile(fc(mixed)), 'intersection')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.type).toBe('mixed-geometry')
  })

  it('rejects empty FeatureCollection', async () => {
    const result = await parseUploadedFile(geojsonFile(fc([])), 'roadway')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.type).toBe('no-features')
  })

  it('rejects Point uploaded as roadway (wrong type)', async () => {
    const result = await parseUploadedFile(geojsonFile(fc([POINT_FEATURE])), 'roadway')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.type).toBe('mixed-geometry')
    expect(result.error.message).toContain('Intersection')
  })

  it('rejects oversized file', async () => {
    const big = new File([new ArrayBuffer(11 * 1024 * 1024)], 'big.geojson')
    const result = await parseUploadedFile(big, 'roadway')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.type).toBe('file-too-large')
  })

  it('rejects invalid JSON', async () => {
    const result = await parseUploadedFile(new File(['not json{'], 'bad.geojson'), 'roadway')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.type).toBe('invalid-format')
  })

  it('rejects unsupported file extension', async () => {
    const result = await parseUploadedFile(new File(['data'], 'test.csv'), 'roadway')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.type).toBe('invalid-format')
  })

  it('extracts attribute columns', async () => {
    const result = await parseUploadedFile(geojsonFile(fc(LINE_FEATURES)), 'roadway')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.result.columns).toContain('label')
  })

  it('surfaces feature.id as a column when not in properties', async () => {
    const withId: Feature = {
      type: 'Feature',
      id: 'abc-123',
      properties: { name: 'test' },
      geometry: { type: 'Point', coordinates: [0, 0] },
    }
    const result = await parseUploadedFile(geojsonFile(fc([withId])), 'intersection')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.result.columns).toContain('id')
    expect(result.result.features[0].properties.id).toBe('abc-123')
  })

  it('handles a single Feature (not wrapped in FeatureCollection)', async () => {
    const result = await parseUploadedFile(geojsonFile(POINT_FEATURE), 'intersection')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.result.features).toHaveLength(1)
  })

  it('carries properties on parsed features', async () => {
    const result = await parseUploadedFile(geojsonFile(fc([POINT_FEATURE])), 'intersection')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.result.features[0].properties).toEqual({ Name: 'Intersection A', id: 1 })
  })

  it('defaults name from common name fields', async () => {
    const variants: Feature[] = [
      { type: 'Feature', properties: { name: 'lower' }, geometry: { type: 'Point', coordinates: [0, 0] } },
      { type: 'Feature', properties: { NAME: 'upper' }, geometry: { type: 'Point', coordinates: [1, 1] } },
      { type: 'Feature', properties: { label: 'lbl' }, geometry: { type: 'Point', coordinates: [2, 2] } },
      { type: 'Feature', properties: { other: 'x' }, geometry: { type: 'Point', coordinates: [3, 3] } },
    ]
    const result = await parseUploadedFile(geojsonFile(fc(variants)), 'intersection')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.result.features.map((f) => f.name)).toEqual(['lower', 'upper', 'lbl', null])
  })
})

describe('applyNameColumn', () => {
  it('overrides names from a chosen column', async () => {
    const result = await parseUploadedFile(geojsonFile(fc(LINE_FEATURES)), 'roadway')
    if (!result.ok) throw new Error('unexpected')
    const renamed = applyNameColumn(result.result.features, 'label')
    expect(renamed.map((f) => f.name)).toEqual(['Segment 1', 'Segment 2', 'Segment 3'])
  })

  it('keeps default name when column value is null', async () => {
    const features: Feature[] = [
      { type: 'Feature', properties: { name: 'A', code: null }, geometry: { type: 'Point', coordinates: [0, 0] } },
      { type: 'Feature', properties: { name: 'B', code: 'X' }, geometry: { type: 'Point', coordinates: [1, 1] } },
    ]
    const result = await parseUploadedFile(geojsonFile(fc(features)), 'intersection')
    if (!result.ok) throw new Error('unexpected')
    const renamed = applyNameColumn(result.result.features, 'code')
    expect(renamed[0].name).toBe('A')
    expect(renamed[1].name).toBe('X')
  })
})

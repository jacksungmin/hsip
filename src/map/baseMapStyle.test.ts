// Pins the basemap contract from config/app.yaml: one URL, and the app works
// out whether it names a vector style document or a raster tile address. A
// vector URL is passed through for MapLibre to fetch; a raster template is
// wrapped in the minimal style document MapLibre requires, since a bare tile
// URL carries none of the metadata a style does.
//
// Worth a test rather than a browser check because only one branch can be
// live at a time, and the raster branch is the one a client switching
// providers will land on.

import { describe, expect, it } from 'vitest'
import { baseMapStyle, isRasterTemplate } from './baseMapStyle'
import type { AppConfig } from '../types'

const raster: AppConfig['basemap'] = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '© OpenStreetMap contributors',
  maxZoom: 19,
  tileSize: 256,
}

const vector: AppConfig['basemap'] = {
  url: 'https://tiles.versatiles.org/assets/styles/neutrino/style.json',
  attribution: '© OpenStreetMap contributors · © VersaTiles',
  maxZoom: 19,
  tileSize: 256,
}

describe('isRasterTemplate', () => {
  it('recognises a tile template by its placeholders, not by extension', () => {
    expect(isRasterTemplate(raster.url)).toBe(true)
    expect(isRasterTemplate('https://example.org/tiles/{z}/{x}/{y}@2x.jpg')).toBe(true)
  })

  it('treats a style URL as vector even when it looks image-like', () => {
    expect(isRasterTemplate(vector.url)).toBe(false)
    expect(isRasterTemplate('https://example.org/style.json?format=png')).toBe(false)
  })
})

describe('baseMapStyle', () => {
  it('passes a vector style URL straight through', () => {
    expect(baseMapStyle(vector)).toBe(vector.url)
  })

  it('wraps a raster template in a one-source, one-layer style document', () => {
    const style = baseMapStyle(raster)
    expect(typeof style).toBe('object')
    if (typeof style === 'string') throw new Error('expected a style object')

    expect(style.version).toBe(8)
    expect(style.layers).toEqual([{ id: 'basemap', type: 'raster', source: 'basemap' }])

    const source = style.sources.basemap
    expect(source).toMatchObject({
      type: 'raster',
      tiles: [raster.url],
      tileSize: 256,
      attribution: raster.attribution,
    })
  })

  // Without a declared maxzoom MapLibre requests tiles past what the provider
  // has and the map goes blank on zoom-in, which is the failure a wrong value
  // here would cause and is invisible until someone zooms.
  it('declares the provider tile depth so closer zooms overzoom instead of blanking', () => {
    const style = baseMapStyle({ ...raster, maxZoom: 17 })
    if (typeof style === 'string') throw new Error('expected a style object')
    expect(style.sources.basemap).toMatchObject({ maxzoom: 17 })
  })
})

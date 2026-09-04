// CustomRegionStore per docs/06 contract.
//
// Holds user-created regions (drawn polygons, uploaded boundaries [P2]).
// Symmetric with JurisdictionStore: both feed into RegionState.setCurrent().

import type { CustomRegion } from '../types'

export type CustomRegionStoreValue = CustomRegion[]

export interface CustomRegionStore {
  get(): CustomRegionStoreValue
  add(region: CustomRegion): void
  remove(regionId: string): void
}

class CustomRegionStoreImpl implements CustomRegionStore {
  #regions = $state<CustomRegion[]>([])

  get(): CustomRegionStoreValue {
    return this.#regions
  }

  add(region: CustomRegion): void {
    this.#regions = [...this.#regions, region]
  }

  remove(regionId: string): void {
    this.#regions = this.#regions.filter((r) => r.id !== regionId)
  }
}

export const customRegionStore: CustomRegionStore = new CustomRegionStoreImpl()

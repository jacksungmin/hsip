// HSIP workcode field list, derived from the countermeasure catalog.
// Source of truth is config/hsip/countermeasures.csv; the JSON is
// generated at build time by vite-plugin-csv-config.

import countermeasures from './generated/countermeasures.json'

export const HSIP_FIELDS = countermeasures.map(
  (cm) => `HSIP_${cm.workcode}` as const,
)

export type HsipFlagKey = (typeof HSIP_FIELDS)[number]

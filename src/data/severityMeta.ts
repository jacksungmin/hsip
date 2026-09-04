import type { Severity } from '../types'

export const SEVERITY_LABELS: Record<Severity, string> = {
  K: 'Fatal',
  A: 'Incapacitating',
  B: 'Non-incapacitating',
}

export const SEVERITY_COLORS: Record<Severity, string> = {
  K: '#5a0906',
  A: '#8a1f1c',
  B: '#c6302c',
}

// MapLibre circle dots use a higher-contrast palette for small-size legibility
export const SEVERITY_MAP_COLORS: Record<Severity, string> = {
  K: '#1a1a1a',
  A: '#d32f2f',
  B: '#fbc02d',
}

// rgba base for heatmap cell backgrounds (without closing alpha)
export const SEVERITY_HEAT_RGBA: Record<string, string> = {
  K: 'rgba(90, 9, 6,',
  A: 'rgba(138, 31, 28,',
  B: 'rgba(198, 48, 44,',
}

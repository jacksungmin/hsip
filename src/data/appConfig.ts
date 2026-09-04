// App identity strings. Loaded from build-generated JSON (source:
// config/app.yaml), which the build plugin has already validated. Sync access
// only: this is baked into the bundle and is there before anything renders.
//
// The theme colours from the same config file do not appear here. They reach
// the app as generated CSS (src/data/generated/theme.css, imported by main.ts)
// rather than as values components read, so that a colour change is a
// stylesheet override rather than something every component has to thread
// through its markup.

import rawConfig from './generated/appConfig.json'
import type { AppConfig } from '../types'

const config: AppConfig = rawConfig as AppConfig

export const identity: AppConfig['identity'] = config.identity
export const support: AppConfig['support'] = config.support
export const basemap: AppConfig['basemap'] = config.basemap

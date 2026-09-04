// Which build of the app is running, and which build of the data it loaded.
//
// The app stamp is the commit GitHub built the site from, baked in at build
// time; see vite.config.ts for why it cannot be read at runtime instead.

import { dataManifest } from '../state/dataManifest.svelte'

// 'dev' for any build that did not run in GitHub Actions.
export const APP_BUILD = __BUILD_SHA__

// Date only: nobody needs the minute a data build finished.
export function dataBuildLabel(): string | null {
  const builtAt = dataManifest.current?.builtAt
  if (!builtAt) return null
  return builtAt.slice(0, 10)
}

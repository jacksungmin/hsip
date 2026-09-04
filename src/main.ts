import { mount } from 'svelte'
import './app.css'
// Generated from config/app.yaml. Imported after app.css so its brand-colour
// overrides win on cascade order, leaving app.css as the full default palette.
import './data/generated/theme.css'
import App from './App.svelte'
import { installGlobalErrorHandlers, reportError } from './services/errorReporter'

// Before mount, so a failure during mounting is caught and the console
// recording covers the whole session (docs/07 "Error handling").
installGlobalErrorHandlers()

// No boot-time default selection — jurisdictions load async, so
// there's nothing to default to at this point. User picks from the
// combobox after load. Session restore (future SessionStore work)
// will rehydrate the prior pick.

let app: ReturnType<typeof mount> | null = null
try {
  app = mount(App, {
    target: document.getElementById('app')!,
  })
} catch (error) {
  // Nothing rendered, so there is no Svelte boundary to catch this and no
  // error surface to show it. A bare message is all that can go on the page.
  reportError(error, { where: 'app startup', fatal: true })
  const target = document.getElementById('app')
  if (target) {
    target.textContent =
      'The application could not start. Reload the page. If this keeps happening, take a screenshot and contact support.'
  }
}

export default app

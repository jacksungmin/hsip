/// <reference types="svelte" />
/// <reference types="vite/client" />

// Substituted by Vite's `define` (see vite.config.ts). It is replaced with a
// string literal before bundling rather than looked up at runtime, so it has
// to be declared here — TypeScript has no way to know the substitution
// happened.
declare const __BUILD_SHA__: string

interface ImportMetaEnv {
  // Preview deployment label; see src/data/release.ts.
  readonly VITE_PREVIEW_LABEL?: string
}

// Preview label for a side-by-side preview deployment, e.g. "2027 HSIP update
// - preview". Set only by the deploy workflow for the preview build
// (VITE_PREVIEW_LABEL); unset everywhere else, including `npm run dev`. When
// set, the header, the splash screen and every exported report say so, so a
// reviewer's report can never be mistaken for one from the official version.
export const PREVIEW_LABEL: string | null = import.meta.env.VITE_PREVIEW_LABEL?.trim() || null

<!-- Cover-page framing block. Prose lives in config/report/coverpage_about.md so
     it can be edited without touching code; this component only substitutes the
     payload-driven tokens (crash-data years and range) and renders the markdown.
     Editing guidance and provenance are in the md file's leading comment. -->
<script lang="ts">
  import { marked } from 'marked'
  import aboutMarkdown from '../../../config/report/coverpage_about.md?raw'
  import type { ReportPayload } from '../../types'

  let { methods }: { methods: ReportPayload['methods'] } = $props()

  const html = $derived.by(() => {
    const tokens: Record<string, string> = {
      dataYears: String(methods.dataYears),
      yearPlural: methods.dataYears === 1 ? '' : 's',
      dataRange: methods.dataRange,
    }
    const filled = aboutMarkdown
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\{\{(\w+)\}\}/g, (match, key: string) => tokens[key] ?? match)
    return marked.parse(filled, { async: false })
  })
</script>

<section class="report-about">
  {@html html}
</section>

<style>
  .report-about {
    margin-top: 24pt;
    break-inside: avoid;
  }

  /* The markdown is injected as raw HTML at runtime, so Svelte's compiler never
     sees those elements and cannot add its scoping class to them. :global()
     opts these rules out of scoping; the .report-about prefix keeps them from
     leaking to the rest of the report. */
  .report-about :global(h2) {
    font-size: 13pt;
    font-weight: 600;
    margin-bottom: 6pt;
    padding-bottom: 3pt;
    border-bottom: 1px solid #ccc;
    break-after: avoid;
  }

  .report-about :global(p) {
    margin: 0 0 8pt;
    text-align: justify;
  }

  .report-about :global(strong) {
    font-weight: 600;
  }
</style>

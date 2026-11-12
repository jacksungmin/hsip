<!-- Cover-page framing block for the exported report: what the report is,
     what it is for, where it sits in the safety management process, and what
     the numbers rest on. Rendered by src/components/report/ReportAbout.svelte.

     Editable prose. Markdown; headings, bold, italics, and lists all work.
     These tokens are substituted at render time from the report payload:
       {{analysisYears}} - number of years in the SII analysis period (e.g. 3)
       {{yearPlural}}    - "" or "s", to agree with {{analysisYears}}
       {{analysisRange}} - the SII analysis period (e.g. "2023-2025")
       {{historyRange}}  - the full crash history in the data (e.g. "2018-2025")
       {{guidelines}}    - the guidelines edition (e.g. "2027 TxDOT HSIP Guidelines")

     Wording is drawn from the Kimley-Horn "HSIP Tool - Benefit-Cost Analysis
     Methodology" memo (Introduction) and the tool scope framing KH asked us to
     carry into user-facing material: this is an economic appraisal tool, not a
     network screening or countermeasure selection tool. It is deliberately
     silent on how multiple countermeasures combine at one site, which is still
     an open methodology question with KH. Keep that silence when editing. -->

## About This Report

**What this report is.** A planning-level benefit-cost screening of candidate
safety improvements at the sites documented in this report. For each site, the
analysis monetizes the crashes an improvement is expected to prevent and
compares that benefit against a planning-level project cost. Benefits are
reported as present worth over the improvement's service life (B); the ratio of
benefit to cost is reported as the Safety Investment Index (SII).

**What it is for.** A benefit-cost ratio does not establish the need (or lack
of need) for a project. It supports comparison and prioritization of candidate
projects, whether for internal planning or for a funding application.

**Where it sits in the process.** This analysis covers the economic appraisal
step of the roadway safety management process. Network screening, diagnosis, and
countermeasure selection are outside its scope and are supported by other tools
and by engineering judgment.

**Basis.** Benefit calculations follow TxDOT's Highway Safety Improvement
Program (HSIP) methodology, per the {{guidelines}}. Crash counts and benefits
use {{analysisYears}} year{{yearPlural}} of KAB crashes ({{analysisRange}}), the
HSIP analysis period, from TxDOT CRIS as processed for the H-GAC Safety Action
Plan. The tool's map holds a longer crash history ({{historyRange}}) for
diagnosis; it does not enter these calculations.
Crash reduction factors, service lives, and maintenance costs are
TxDOT-prescribed values; project costs are entered by the analyst. Formulas and
the values used appear in Appendix B.

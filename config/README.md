# Configuration

Everything in this folder is read at build time and baked into the app.
Nothing here is a runtime setting: after an edit, the app has to be
rebuilt and redeployed for the change to appear.

A malformed file fails the build with a message naming what is wrong,
so a bad edit cannot reach the deployed site. The exception is a wrong
*value* in a right-shaped file — see the warnings below.

The folder is in two halves, and they are not equally safe to edit.

## Presentation — yours to change

Appearance and wording. A bad edit here makes the app look wrong, which
is obvious and reversible.

| File | What it controls |
|---|---|
| `app.yaml` | App name, navbar subtitle, brand colours, the map's background layer |
| `overlays.yaml` | Which reference layers are in the map's Layers panel, and how they are drawn |
| `splash.md` | The welcome text on the loading screen |
| `report/coverpage_about.md` | The "About This Report" prose on the exported report's cover page |
| `assets/logo.png` | The mark in the navbar and on the splash screen |

Two images are swapped by replacing the file rather than by naming it in
a config file: `assets/logo.png` above, and `../public/favicon.png` for
the browser tab icon. There is no filename to mistype that way.

`overlays.yaml` can restyle and rearrange layers, and can hide one, but
it cannot add a dataset. New data needs an entry in
`../tools/data-build/build-config.yaml`, the source file in
`../input_data/`, and a data build run.

Two warnings about values that are shaped right but wrong. In
`overlays.yaml`, a mistyped `column` name fails the build, but a
mistyped `value` or `equals` is matched literally against the data and
simply matches nothing, so a layer can come up empty. And in `app.yaml`,
`theme.primary` has white text drawn on top of it: pick something too
pale and the navbar becomes unreadable. Neither is checked for you.

## Methodology — needs a safety engineer

TxDOT reference values and the crash-tagging logic. These decide the
numbers in an exported report, so a wrong edit does not look wrong. It
produces plausible figures that are quietly incorrect, in a document
that may go into a funding application. Change these only with a source
to cite.

| File | What it is | When it changes |
|---|---|---|
| `hsip/crash_costs.csv` | Dollar value per KAB severity | TxDOT publishes new values |
| `hsip/countermeasures.csv` | The HSIP countermeasure catalog: reduction factors, service life, emphasis areas | TxDOT revises the HSIP guide |
| `hsip/hsip_rules.yaml` | Which crashes each countermeasure is credited against | A crediting rule is found to be wrong |
| `hsip/ea_rules.yaml` | Which crashes fall into each emphasis area | An emphasis area definition changes |

The two `*_rules.yaml` files share one condition language, documented in
the header of each. Both have the same trap: **a misspelled CRIS field
name does not fail.** It matches nothing, so the rule tags zero crashes
and neither the build nor the app says a word. After editing a rule,
check that its flag count is not zero.

`hsip/countermeasures.csv` and `hsip/hsip_rules.yaml` are coupled: the
`Work Code` column and the rule ids must correspond one-to-one. Add or
remove a work code in both files together. The header of
`hsip_rules.yaml` explains what breaks if they drift.

## schemas/

Machine-readable validation for `app.yaml` and `overlays.yaml`. Not
edited by hand, and not read by the build — it is what makes those files
validate live in an editor. Install the "YAML" extension
(`redhat.vscode-yaml`) and both files check themselves as you type, with
hover help on every key.

The build does its own separate checking, including things a schema
cannot know: whether an overlay's `source` and column names actually
exist in the published tiles, and whether a colour is a usable hex
value.

## What is not here

Crash severity colours (K/A/B) are in `../src/data/severityMeta.ts`, and
the rest of the colour palette is in `../src/app.css`. The severity
colours are a safety-field reading convention — recolouring them makes
the maps harder for other practitioners to read — so they are
deliberately not exposed as configuration.

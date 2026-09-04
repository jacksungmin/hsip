"""Content-hash publish step for build artifacts.

Artifacts are published under content-hashed filenames
(e.g. app-a1b2c3d4.db), with manifest.json as the mutable pointer
the app fetches fresh each boot. Hashed files in the output dir are
the ONLY persistent copies; stable names (app.db, ...) exist only
transiently while a build runs. See docs/07-tech-decisions.md,
cache invalidation section.

Publish order keeps the published set coherent if a run dies:
hash and rename touched artifacts, write the manifest atomically,
prune superseded files last.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

# Bumped to 2 when overlay tilesets moved out of `artifacts` into their own
# open-ended `overlays` section, and to 3 when `crashData` arrived. The app
# refuses a manifest whose version it does not know, so an app deployed against
# an older one fails loudly rather than reporting a missing artifact it was
# never going to find — or, for v3, rather than falling back to a stale
# hardcoded exposure period and silently scaling every benefit calculation.
SCHEMA_VERSION = 3
MANIFEST_NAME = "manifest.json"

# Artifact key -> stable (working) filename, for the artifacts app code names
# by hand. Closed set: adding one means writing code that reads it.
CORE_ARTIFACTS = {
    "appDb": "app.db",
    "crashTiles": "crashes_kab.pmtiles",
    "jurisdictions": "jurisdictions.geojson",
}

# Layer (the --only vocabulary) -> core artifact keys it produces. A layer
# writes to the shared .db exactly when it lists appDb; that drives the
# checkout step in build.py. Overlays are not here: they come from
# build-config's `overlays` mapping, one artifact each, never the db.
CORE_LAYER_ARTIFACTS = {
    "crashes": ["crashTiles", "appDb"],
    "jurisdictions": ["jurisdictions"],
}

DB_ARTIFACT = "appDb"

# Which extensions the prune step considers publishable output. Anything else
# in the output dir (favicon.png) is not ours to delete.
HASHED_SUFFIXES = (".pmtiles", ".db", ".geojson")
_HASHED_ANY = re.compile(
    r"^.+-[0-9a-f]{8}(" + "|".join(re.escape(s) for s in HASHED_SUFFIXES) + r")$"
)


def stable_path(output_dir: Path, key: str) -> Path:
    return output_dir / CORE_ARTIFACTS[key]


def overlay_stable_name(name: str) -> str:
    """One name governs everything: the config key is the file, the tileset's
    internal layer name, the manifest key, and what config/overlays.yaml
    references as `source`. Nothing to keep in sync."""
    return f"{name}.pmtiles"


def overlay_stable_path(output_dir: Path, name: str) -> Path:
    return output_dir / overlay_stable_name(name)


def read_manifest(output_dir: Path) -> dict | None:
    p = output_dir / MANIFEST_NAME
    if not p.exists():
        return None
    with open(p) as f:
        return json.load(f)


def checkout_db(output_dir: Path) -> None:
    """Copy the current published .db to its stable working name.

    The shared .db is rebuilt incrementally (each layer drops and
    recreates only its own tables), so a run that touches it needs
    the previous content as its starting point. Copy, not rename:
    the published set stays intact if the run dies mid-build.
    """
    manifest = read_manifest(output_dir)
    entry = (manifest or {}).get("artifacts", {}).get(DB_ARTIFACT)
    if entry is None:
        print("No manifest entry for the db; it builds from scratch")
        return
    src = output_dir / entry
    if not src.exists():
        raise FileNotFoundError(
            f"manifest lists {entry} but the file is missing; "
            "restore it or run a full build"
        )
    shutil.copyfile(src, stable_path(output_dir, DB_ARTIFACT))
    print(f"Checked out {entry} -> {CORE_ARTIFACTS[DB_ARTIFACT]}")


def publish(
    output_dir: Path,
    touched: set[str],
    overlays: dict[str, dict | None] | None = None,
    crash_years: list[int] | None = None,
) -> dict:
    """Promote built artifacts to hashed names, write manifest, prune.

    `touched` names core artifact keys rebuilt this run. `overlays` maps every
    overlay declared in build-config to its inventory (layer name and the
    fields that reached the tiles) when it was built this run, or None when it
    was not. Untouched artifacts keep their entry from the previous manifest;
    an untouched artifact with no manifest entry but a stable-named file
    present is migrated (first run on a pre-manifest layout).

    `crash_years` is every distinct crash year the crash build ingested, or
    None when this run did not rebuild crashes — in which case the previous
    manifest's value carries forward, same as an untouched artifact.

    build-config is the sole authority on which overlays exist, so an overlay
    dropped from it loses its manifest entry and has its files pruned on the
    next run of any kind, `--only` included. Re-adding it and rebuilding
    restores it; nothing else is needed to retire one.
    """
    print("\n=== Publish ===")
    prev = read_manifest(output_dir) or {}
    prev_artifacts = prev.get("artifacts", {})
    prev_overlays = prev.get("overlays", {})
    overlays = overlays or {}

    entries: dict[str, str] = {}
    for key, stable_name in CORE_ARTIFACTS.items():
        entries[key] = _resolve(
            output_dir,
            key,
            output_dir / stable_name,
            built=key in touched,
            prev_entry=prev_artifacts.get(key),
            vacuum=key == DB_ARTIFACT,
        )

    overlay_entries: dict[str, dict] = {}
    for name, inventory in overlays.items():
        prev_entry = prev_overlays.get(name, {})
        filename = _resolve(
            output_dir,
            name,
            overlay_stable_path(output_dir, name),
            built=inventory is not None,
            prev_entry=prev_entry.get("file"),
        )
        if inventory is None:
            if "sourceLayer" not in prev_entry:
                raise ValueError(
                    f"overlay '{name}' has a published file but no inventory in "
                    f"the manifest; run `python build.py --only {name}` once"
                )
            inventory = {k: v for k, v in prev_entry.items() if k != "file"}
        overlay_entries[name] = {"file": filename, **inventory}

    published = {**entries, **{n: e["file"] for n, e in overlay_entries.items()}}
    build_id = hashlib.sha256(
        ",".join(f"{k}:{_digest_of(published[k])}" for k in sorted(published)).encode()
    ).hexdigest()[:8]

    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "buildId": build_id,
        "builtAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "artifacts": {k: entries[k] for k in sorted(entries)},
        "overlays": {k: overlay_entries[k] for k in sorted(overlay_entries)},
        "crashData": _resolve_crash_data(crash_years, prev.get("crashData")),
    }

    if _same_except_built_at(prev, manifest):
        print(f"  Manifest unchanged (buildId {build_id})")
        manifest = prev
    else:
        tmp = output_dir / (MANIFEST_NAME + ".tmp")
        with open(tmp, "w") as f:
            json.dump(manifest, f, indent=2)
            f.write("\n")
        os.replace(tmp, output_dir / MANIFEST_NAME)
        print(f"  Wrote {MANIFEST_NAME} (buildId {build_id})")

    _prune(output_dir, set(published.values()))
    return manifest


def _resolve_crash_data(
    crash_years: list[int] | None, prev_entry: dict | None
) -> dict:
    """Settle the crash-data provenance block: use what this run ingested, else
    carry the previous manifest's forward.

    There is deliberately no fallback past that. The year count divides every
    SII benefit calculation and the range is printed on the report cover page,
    so a guessed value would not fail — it would publish plausible, uniformly
    wrong numbers into a funding application.
    """
    if crash_years is None:
        if not prev_entry or not prev_entry.get("years"):
            raise ValueError(
                "no crash-data provenance: this run did not build crashes and the "
                "previous manifest has no `crashData`. Run `python build.py --only "
                "crashes` once (a pre-v3 manifest predates this section)."
            )
        print(f"  crashData carried forward: {len(prev_entry['years'])} years")
        return prev_entry

    if not crash_years:
        raise ValueError("crash build produced no crash years; refusing to publish")

    span = crash_years[-1] - crash_years[0] + 1
    if span != len(crash_years):
        missing = sorted(set(range(crash_years[0], crash_years[-1] + 1)) - set(crash_years))
        print(
            f"  WARNING: crash years have gaps, missing {missing}. The app divides "
            f"by {len(crash_years)} (years present), not {span} (the span)."
        )
    print(f"  crashData: {len(crash_years)} years, {crash_years[0]}-{crash_years[-1]}")
    return {"years": crash_years}


def _resolve(
    output_dir: Path,
    key: str,
    stable: Path,
    built: bool,
    prev_entry: str | None,
    vacuum: bool = False,
) -> str:
    """Settle on the published filename for one artifact: promote what this run
    built, else keep the previous manifest entry, else migrate a stable-named
    file. A hole in the published set is an error, not a smaller manifest."""
    prev_ok = prev_entry is not None and (output_dir / prev_entry).exists()

    if built:
        if not stable.exists():
            raise FileNotFoundError(f"'{key}' was built this run but {stable} is missing")
        if vacuum:
            _vacuum(stable)
        return _promote(output_dir, stable)

    if prev_ok:
        if stable.exists():
            print(
                f"  WARNING: stray working copy {stable.name} ignored "
                "(leftover from a dead run?); manifest entry kept"
            )
        return prev_entry

    if stable.exists():
        name = _promote(output_dir, stable)
        print(f"  Migrated stable-named {stable.name}")
        return name

    raise FileNotFoundError(
        f"no artifact for '{key}': not built this run, no usable manifest "
        f"entry, no {stable.name} in {output_dir}. Run a full build."
    )


def _promote(output_dir: Path, stable: Path) -> str:
    digest = _hash_file(stable)
    name = f"{stable.stem}-{digest}{stable.suffix}"
    target = output_dir / name
    if target.exists():
        # Rebuild produced byte-identical content; already published.
        stable.unlink()
    else:
        stable.rename(target)
    print(f"  {stable.name} -> {name} ({target.stat().st_size / 1e6:.1f} MB)")
    return name


def _prune(output_dir: Path, keep: set[str]) -> None:
    """Delete every hashed artifact the new manifest does not point at.

    Matches on shape rather than on a per-key pattern, so files left behind by
    an overlay that was removed from build-config are pruned too. Only the
    extensions this pipeline publishes are candidates.
    """
    for p in sorted(output_dir.iterdir()):
        if _HASHED_ANY.match(p.name) and p.name not in keep:
            p.unlink()
            print(f"  Pruned {p.name}")


def _vacuum(db_path: Path) -> None:
    # Drop-and-recreate leaves freelist pages; don't ship them.
    before = db_path.stat().st_size / 1e6
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA journal_mode = DELETE")
    conn.execute("VACUUM")
    conn.close()
    print(f"  VACUUM {db_path.name}: {before:.1f} -> {db_path.stat().st_size / 1e6:.1f} MB")


def _hash_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:8]


def _digest_of(filename: str) -> str:
    m = re.search(r"-([0-9a-f]{8})\.[^.]+$", filename)
    if not m:
        raise ValueError(f"cannot parse content hash from {filename}")
    return m.group(1)


def _same_except_built_at(a: dict, b: dict) -> bool:
    strip = lambda d: {k: v for k, v in d.items() if k != "builtAt"}
    return strip(a) == strip(b)

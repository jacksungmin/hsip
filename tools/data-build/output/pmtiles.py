"""Build PMTiles via tippecanoe from a GeoDataFrame."""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

import geopandas as gpd


def build_pmtiles(
    gdf: gpd.GeoDataFrame,
    fields: list[str],
    tippecanoe_flags: list[str],
    output_path: Path,
    layer: str,
) -> dict:
    """Write a GeoDataFrame subset to PMTiles via tippecanoe.

    Selects `fields` + geometry, writes temp GeoJSON, runs tippecanoe.

    `layer` is the tileset's internal layer name, passed to tippecanoe as -l.
    It comes from the caller rather than the config's flag list so that one
    name governs the file, the layer inside it, and the manifest key.

    Returns the tileset's inventory — its layer name and the fields that
    actually reached the tiles, which is what the app build validates
    config/overlays.yaml against. Reporting `available` rather than the
    requested `fields` means a column dropped for being absent from the
    source cannot later look styleable.
    """
    # A hand-written -l would win or lose depending on flag order; refuse it
    # rather than let the manifest disagree with the tiles.
    if any(flag in ("-l", "--layer") for flag in tippecanoe_flags):
        raise ValueError(
            f"tippecanoe flags for '{layer}' name a layer with -l; remove it, "
            "the layer name comes from the config key"
        )
    source_layer = layer
    tippecanoe_flags = [*tippecanoe_flags, "-l", layer]

    available = [f for f in fields if f in gdf.columns]
    missing = set(fields) - set(available)
    if missing:
        print(f"  WARNING: PMTiles fields not in data: {sorted(missing)}")

    subset = gdf[available + ["geometry"]].copy()

    if subset.crs and subset.crs.to_epsg() != 4326:
        subset = subset.to_crs("EPSG:4326")

    with tempfile.NamedTemporaryFile(suffix=".geojson", delete=False) as tmp:
        tmp_path = Path(tmp.name)

    try:
        subset.to_file(tmp_path, driver="GeoJSON")
        print(f"  Wrote {len(subset):,} features to temp GeoJSON ({tmp_path.stat().st_size / 1e6:.1f} MB)")

        cmd = ["tippecanoe", "-o", str(output_path), "--force", *tippecanoe_flags, str(tmp_path)]
        print(f"  Running: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            print(result.stderr)
            raise RuntimeError(f"tippecanoe failed with exit code {result.returncode}")

        print(f"  PMTiles: {output_path} ({output_path.stat().st_size / 1e6:.1f} MB)")
    finally:
        tmp_path.unlink(missing_ok=True)

    return {"sourceLayer": source_layer, "fields": available}

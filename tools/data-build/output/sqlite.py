"""Build SQLite .db from GeoDataFrames.

Replicates the schema from src/services/db/sqliteWorker.ts. The .db
produced here is loaded directly by the app's OPFS-SAH worker,
skipping the ESRI fetch + client-side ingest pipeline.
"""

from __future__ import annotations

import sqlite3
import time
from pathlib import Path
from time import perf_counter

import geopandas as gpd
import numpy as np
import pandas as pd


# --- Flag codec (matches src/services/db/flagCodec.ts) ---
# Bit i -> byte floor(i/8), position i%8, LSB-first.

def encode_flags_vectorized(gdf: gpd.GeoDataFrame, keys: list[str]) -> list[bytes]:
    """Encode flag columns into packed byte blobs for all rows at once."""
    n_rows = len(gdf)
    n_bytes = (len(keys) + 7) // 8
    buf = np.zeros((n_rows, n_bytes), dtype=np.uint8)

    for i, key in enumerate(keys):
        if key not in gdf.columns:
            continue
        col = gdf[key].fillna(0).astype(np.uint8).values
        buf[:, i >> 3] |= col << (i & 7)

    return [bytes(row) for row in buf]


# --- Schema creation ---

UNINCORPORATED_CITY_ID = 9999


def _init_db(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA synchronous = NORMAL")
    # Rollback journal, NOT WAL: the artifact is read-only at runtime,
    # and a WAL-stamped header breaks the app's in-memory fallback
    # (sqlite3_deserialize cannot open -wal/-shm sidecars -> CANTOPEN).
    conn.execute("PRAGMA journal_mode = DELETE")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS _cache_meta (
            layer TEXT PRIMARY KEY,
            ingested_at INTEGER NOT NULL,
            source_url TEXT
        )
    """)
    return conn


def _create_crash_tables(conn: sqlite3.Connection, flag_cols: list[str]) -> None:
    flag_ddl = ",\n  ".join(f"{c} INTEGER NOT NULL DEFAULT 0" for c in flag_cols)
    conn.executescript(f"""
        DROP TABLE IF EXISTS crash_rtree;
        DROP TABLE IF EXISTS crashes;
        CREATE TABLE crashes (
            id INTEGER PRIMARY KEY,
            date TEXT NOT NULL,
            severity TEXT NOT NULL,
            lon REAL NOT NULL,
            lat REAL NOT NULL,
            county_id TEXT NOT NULL,
            city_id TEXT,
            ea_flags BLOB NOT NULL,
            hsip_flags BLOB NOT NULL,
            {flag_ddl}
        );
        CREATE INDEX idx_crashes_county ON crashes(county_id);
        CREATE INDEX idx_crashes_city ON crashes(city_id);
        CREATE VIRTUAL TABLE crash_rtree USING rtree(
            id, minX, maxX, minY, maxY
        );
    """)


def build_crash_table(
    gdf: gpd.GeoDataFrame,
    ea_ids: list[str],
    hsip_fields: list[str],
    db_path: Path,
) -> int:
    """Write crash GeoDataFrame to the crashes table in .db."""
    flag_cols = [*ea_ids, *hsip_fields]
    conn = _init_db(db_path)
    _create_crash_tables(conn, flag_cols)

    t0 = perf_counter()

    # Vectorized column extraction
    crash_ids = gdf["Crash_ID"].astype(int).values
    dates = gdf["Crash_Date"].astype(str).values
    severities = gdf["kabco"].astype(str).values
    lons = gdf.geometry.x.values
    lats = gdf.geometry.y.values
    county_ids = gdf["county_id"].astype(int).astype(str).values

    city_raw = gdf["city_id"]
    city_ids = []
    for v in city_raw:
        if pd.isna(v) or int(v) == UNINCORPORATED_CITY_ID:
            city_ids.append(None)
        else:
            city_ids.append(str(int(v)))

    ea_blobs = encode_flags_vectorized(gdf, ea_ids)
    hsip_blobs = encode_flags_vectorized(gdf, hsip_fields)

    # Per-flag integer columns
    flag_arrays = []
    for k in flag_cols:
        if k in gdf.columns:
            flag_arrays.append(gdf[k].fillna(0).astype(int).values)
        else:
            flag_arrays.append(np.zeros(len(gdf), dtype=int))

    # Build row tuples
    base_cols = ["id", "date", "severity", "lon", "lat", "county_id", "city_id",
                 "ea_flags", "hsip_flags"]
    all_cols = [*base_cols, *flag_cols]
    placeholders = ", ".join("?" for _ in all_cols)
    insert_sql = f"INSERT INTO crashes ({', '.join(all_cols)}) VALUES ({placeholders})"
    rtree_sql = "INSERT INTO crash_rtree (id, minX, maxX, minY, maxY) VALUES (?, ?, ?, ?, ?)"

    crash_rows = []
    rtree_rows = []
    for i in range(len(gdf)):
        base = [
            int(crash_ids[i]), dates[i], severities[i],
            float(lons[i]), float(lats[i]),
            county_ids[i], city_ids[i],
            ea_blobs[i], hsip_blobs[i],
        ]
        flags = [int(fa[i]) for fa in flag_arrays]
        crash_rows.append((*base, *flags))
        rtree_rows.append((int(crash_ids[i]), float(lons[i]), float(lons[i]),
                           float(lats[i]), float(lats[i])))

    cursor = conn.cursor()
    cursor.execute("BEGIN")
    cursor.executemany(insert_sql, crash_rows)
    cursor.executemany(rtree_sql, rtree_rows)
    conn.commit()

    count = len(crash_rows)
    elapsed = perf_counter() - t0

    cursor.execute(
        "INSERT OR REPLACE INTO _cache_meta (layer, ingested_at, source_url) "
        "VALUES (?, ?, ?)",
        ["crashes", int(time.time() * 1000), None],
    )
    conn.commit()
    conn.close()

    size_mb = db_path.stat().st_size / 1e6
    print(f"  Crash table: {count:,} rows in {elapsed:.1f}s ({size_mb:.1f} MB)")
    return count

"""
CRIS CSV file discovery, loading, and person table merging.

Expects raw TxDOT CRIS public extract CSVs organized under a root
folder (flat or nested by year). Discovers files by naming pattern,
loads and concatenates per table type, merges person + primaryperson
into a single person table.

Returns three DataFrames keyed by Crash_ID: crash, unit, person.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd


TABLE_PATTERNS = {
    "crash": "_crash_",
    "unit": "_unit_",
    "person": "_person_",
    "primaryperson": "_primaryperson_",
}


def discover_csvs(root: Path) -> dict[str, list[Path]]:
    """Find CRIS extract CSVs under root, grouped by table type."""
    if not root.is_dir():
        raise FileNotFoundError(f"Data root not found: {root}")

    found: dict[str, list[Path]] = {k: [] for k in TABLE_PATTERNS}

    for csv_path in sorted(root.rglob("*.csv")):
        name = csv_path.name.lower()
        # Check primaryperson before person (substring match order)
        if TABLE_PATTERNS["primaryperson"] in name:
            found["primaryperson"].append(csv_path)
        elif TABLE_PATTERNS["person"] in name:
            found["person"].append(csv_path)
        elif TABLE_PATTERNS["crash"] in name:
            found["crash"].append(csv_path)
        elif TABLE_PATTERNS["unit"] in name:
            found["unit"].append(csv_path)

    missing = [t for t, paths in found.items() if not paths]
    if missing:
        raise FileNotFoundError(
            f"Missing CRIS extract(s) under {root}: {', '.join(missing)}"
        )

    for t, paths in found.items():
        print(f"  {t}: {len(paths)} file(s)")

    return found


def load_table(
    paths: list[Path],
    usecols: list[str] | None = None,
) -> pd.DataFrame:
    """Read and concat CSVs for one table type."""
    frames = []
    for p in paths:
        df = pd.read_csv(p, usecols=usecols, low_memory=False)
        frames.append(df)

    if not frames:
        return pd.DataFrame()

    combined = pd.concat(frames, ignore_index=True)
    combined = combined.drop_duplicates()
    combined = combined.dropna(how="all")
    return combined


def merge_persons(
    person_df: pd.DataFrame,
    primaryperson_df: pd.DataFrame,
) -> pd.DataFrame:
    """Merge person and primaryperson tables.

    CRIS splits person records across two extracts. Merge on the
    composite key (Crash_ID, Unit_Nbr, Prsn_Nbr). When both tables
    have a value for the same field, primaryperson takes precedence.
    """
    keys = ["Crash_ID", "Unit_Nbr", "Prsn_Nbr"]

    for df in (person_df, primaryperson_df):
        for k in keys:
            if k not in df.columns:
                df[k] = pd.NA

    person_unique = person_df.drop_duplicates(subset=keys)
    primary_unique = primaryperson_df.drop_duplicates(subset=keys)

    merged = person_unique.merge(
        primary_unique, on=keys, how="outer", suffixes=("_person", "_primary")
    )
    result = merged[keys].copy()

    all_columns = sorted(
        (set(person_unique.columns) | set(primary_unique.columns)) - set(keys)
    )
    for col in all_columns:
        person_col = (
            col
            if col in person_unique.columns and col not in primary_unique.columns
            else f"{col}_person"
        )
        primary_col = (
            col
            if col in primary_unique.columns and col not in person_unique.columns
            else f"{col}_primary"
        )

        person_series = (
            merged[person_col]
            if person_col in merged.columns
            else pd.Series(pd.NA, index=merged.index)
        )
        primary_series = (
            merged[primary_col]
            if primary_col in merged.columns
            else pd.Series(pd.NA, index=merged.index)
        )
        result[col] = primary_series.where(primary_series.notna(), person_series)

    return result


def load_cris_data(
    root: Path,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Discover, load, and merge CRIS extracts.

    Loads all columns from each table. Filter rules may reference any
    CRIS field, so selective loading would break on config changes.

    Returns (crash_df, unit_df, person_df) where person_df is the
    merged person + primaryperson table.
    """
    print(f"Discovering CRIS extracts under {root}")
    csvs = discover_csvs(root)

    print("Loading crash table...")
    crash_df = load_table(csvs["crash"])
    crash_df = crash_df.drop_duplicates(subset=["Crash_ID"], keep="last")
    print(f"  {len(crash_df):,} unique crashes")

    print("Loading unit table...")
    unit_df = load_table(csvs["unit"])
    crash_ids = set(crash_df["Crash_ID"])
    unit_df = unit_df[unit_df["Crash_ID"].isin(crash_ids)].copy()
    print(f"  {len(unit_df):,} unit rows")

    print("Loading person tables...")
    person_df = load_table(csvs["person"])
    primaryperson_df = load_table(csvs["primaryperson"])
    person_df = person_df[person_df["Crash_ID"].isin(crash_ids)].copy()
    primaryperson_df = primaryperson_df[
        primaryperson_df["Crash_ID"].isin(crash_ids)
    ].copy()

    print("Merging person + primaryperson...")
    merged_person = merge_persons(person_df, primaryperson_df)
    print(f"  {len(merged_person):,} merged person rows")

    return crash_df, unit_df, merged_person

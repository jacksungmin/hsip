"""
Config-driven tagging engine for EA and HSIP flags.

Reads a YAML config file defining tagging rules, evaluates each rule
against crash/unit/person DataFrames, and produces a DataFrame of
0/1 (or nullable) flag columns indexed by Crash_ID.

Condition language (evaluated per row):
  field + in: [values]         -- field value in list
  field + range: [min, max]    -- field value between min and max inclusive
  field + not_in: [values]     -- field value not in list
  and: [conditions]            -- all must match
  or: [conditions]             -- any must match

Aggregation (roll up sub-table rows to crash level):
  any           -- boolean: any row matches → 1, else 0
  any_nullable  -- tri-state: match → 1, known but no match → 0,
                   field unknown → null. Requires known_field.

Paths evaluate against a table, aggregate to crash level.
Groups nest paths with their own combine.
Multiple paths/groups combine with or | and.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd
import yaml


def load_config(path: Path) -> dict:
    with open(path) as f:
        return yaml.safe_load(f)


def evaluate_condition(
    df: pd.DataFrame,
    condition: dict | list,
) -> pd.Series:
    """Evaluate a condition tree against a DataFrame, returning a boolean Series."""

    if "and" in condition:
        result = pd.Series(True, index=df.index)
        for child in condition["and"]:
            result = result & evaluate_condition(df, child)
        return result

    if "or" in condition:
        result = pd.Series(False, index=df.index)
        for child in condition["or"]:
            result = result | evaluate_condition(df, child)
        return result

    field = condition.get("field")
    if field is None:
        raise ValueError(f"Condition missing 'field': {condition}")

    if field not in df.columns:
        return pd.Series(False, index=df.index)

    series = pd.to_numeric(df[field], errors="coerce")

    if "in" in condition:
        return series.isin(condition["in"]).fillna(False)

    if "range" in condition:
        lo, hi = condition["range"]
        return series.between(lo, hi, inclusive="both").fillna(False)

    if "not_in" in condition:
        has_value = series.notna()
        return (has_value & ~series.isin(condition["not_in"])).fillna(False)

    raise ValueError(f"Condition has no operator (in/range/not_in): {condition}")


def aggregate_any(
    mask: pd.Series,
    crash_ids: pd.Series,
) -> pd.Series:
    """Aggregate boolean mask to crash level: any match → True."""
    return mask.groupby(crash_ids).any()


def aggregate_any_nullable(
    match_mask: pd.Series,
    known_mask: pd.Series,
    crash_ids: pd.Series,
) -> pd.Series:
    """Aggregate to crash level with tri-state: 1/0/null.

    Returns Int64 Series indexed by Crash_ID.
    1 = at least one row matched
    0 = all known values present but none matched
    null = no known values for this crash
    """
    any_matched = match_mask.groupby(crash_ids).any()
    any_known = known_mask.groupby(crash_ids).any()

    result = pd.Series(pd.NA, index=any_known.index, dtype="Int64")
    result.loc[any_matched] = 1
    result.loc[any_known & ~any_matched] = 0
    return result


def evaluate_path(
    path_def: dict,
    tables: dict[str, pd.DataFrame],
) -> pd.Series:
    """Evaluate a single path against its table, return crash-level result."""

    table_name = path_def["table"]
    df = tables.get(table_name)
    if df is None or df.empty:
        return pd.Series(dtype="bool")

    condition = path_def["condition"]
    aggregate = path_def.get("aggregate")

    row_mask = evaluate_condition(df, condition)

    if table_name == "crash":
        # Crash table: one row per crash, return boolean indexed by Crash_ID
        return pd.Series(
            row_mask.values, index=tables["crash"]["Crash_ID"].values
        )

    crash_ids = df["Crash_ID"]

    if aggregate == "any_nullable":
        known_field = path_def.get("known_field")
        if known_field is None:
            raise ValueError("any_nullable requires known_field")
        known_mask = pd.to_numeric(df[known_field], errors="coerce").notna()
        return aggregate_any_nullable(row_mask, known_mask, crash_ids)

    # Default: aggregate any
    return aggregate_any(row_mask, crash_ids)


def evaluate_group(
    group_def: dict,
    tables: dict[str, pd.DataFrame],
    all_crash_ids: pd.Series,
) -> pd.Series:
    """Evaluate a group of paths with its own combine logic."""
    combine = group_def.get("combine", "or")
    path_results = []

    for sub_path in group_def["paths"]:
        if "group" in sub_path:
            r = evaluate_group(sub_path["group"], tables, all_crash_ids)
        else:
            r = evaluate_path(sub_path, tables)
        path_results.append(r)

    return combine_results(path_results, combine, all_crash_ids)


def combine_results(
    results: list[pd.Series],
    combine: str,
    all_crash_ids: pd.Series,
) -> pd.Series:
    """Combine multiple crash-level results with or/and.

    Returns Series indexed by Crash_ID values.
    """
    crash_id_values = all_crash_ids.values

    if not results:
        return pd.Series(False, index=crash_id_values)

    # Align all results to the full crash ID index
    aligned = []
    for r in results:
        s = all_crash_ids.map(r)
        s.index = crash_id_values
        if s.dtype == "Int64":
            aligned.append(s)
        else:
            aligned.append(s.fillna(False).astype(bool))

    if combine == "and":
        result = aligned[0]
        for s in aligned[1:]:
            result = result & s
        return result
    else:
        result = aligned[0]
        for s in aligned[1:]:
            result = result | s
        return result


def evaluate_rule(
    rule: dict,
    tables: dict[str, pd.DataFrame],
    all_crash_ids: pd.Series,
) -> pd.Series:
    """Evaluate one tagging rule, return crash-level flag Series."""

    if rule.get("match_all"):
        return pd.Series(1, index=all_crash_ids.index, dtype=int)

    paths = rule.get("paths", [])
    combine = rule.get("combine", "or")

    path_results = []
    for path_def in paths:
        if "group" in path_def:
            r = evaluate_group(path_def["group"], tables, all_crash_ids)
        else:
            r = evaluate_path(path_def, tables)
        path_results.append(r)

    combined = combine_results(path_results, combine, all_crash_ids)

    if rule.get("nullable"):
        if combined.dtype == "Int64":
            return combined
        return combined.astype("Int64")

    if combined.dtype == "Int64":
        return combined.fillna(0).astype(int)

    return combined.fillna(False).astype(int)


def run_tagging(
    config_path: Path,
    tables: dict[str, pd.DataFrame],
    prefix: str,
) -> pd.DataFrame:
    """Run all rules from a config file, return DataFrame of flag columns.

    Args:
        config_path: Path to YAML config (ea_rules.yaml or hsip_rules.yaml).
        tables: Dict with keys 'crash', 'unit', 'person' → DataFrames.
        prefix: Column name prefix ('EA_' or 'HSIP_').

    Returns:
        DataFrame indexed by row position (same as crash_df), with one
        column per rule named {prefix}{rule_id}.
    """
    config = load_config(config_path)
    rules = config.get("rules", [])

    crash_df = tables["crash"]
    all_crash_ids = crash_df["Crash_ID"]

    result = pd.DataFrame({"Crash_ID": all_crash_ids.values})

    for rule in rules:
        rule_id = rule["id"]
        col_name = f"{prefix}{rule_id}"

        flag = evaluate_rule(rule, tables, all_crash_ids)

        # Align to crash_df row order
        flag_by_id = pd.Series(flag.values, index=all_crash_ids.values)
        result[col_name] = crash_df["Crash_ID"].map(flag_by_id).values

    print(f"  Tagged {len(rules)} rules with prefix {prefix}")
    return result

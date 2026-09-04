"""Build config loading and field list derivation."""

from __future__ import annotations

import csv
from pathlib import Path

import yaml


def load_build_config(config_path: Path) -> dict:
    with open(config_path) as f:
        return yaml.safe_load(f)


def derive_ea_ids(config_dir: Path) -> list[str]:
    """Derive EA flag field names from ea_rules.yaml."""
    with open(config_dir / "ea_rules.yaml") as f:
        config = yaml.safe_load(f)
    return [f"EA_{r['id']}" for r in config["rules"]]


def derive_hsip_fields(config_dir: Path) -> list[str]:
    """Derive HSIP flag field names from countermeasures.csv."""
    codes: list[str] = []
    with open(config_dir / "countermeasures.csv", newline="") as f:
        for row in csv.DictReader(f):
            wc = row.get("Work Code", "").strip()
            if wc:
                codes.append(f"HSIP_{wc}")
    return codes

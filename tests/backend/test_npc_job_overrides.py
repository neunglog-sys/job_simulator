from __future__ import annotations

import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def _load_validator():
    path = ROOT / "scripts" / "validate-npc-job-overrides.py"
    spec = importlib.util.spec_from_file_location("validate_npc_job_overrides", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_all_npc_job_overrides_are_valid():
    errors, counts = _load_validator().validate()
    assert errors == []
    assert counts == {
        "files": 103,
        "jobs": 103,
        "families": 24,
        "integrated": 72,
        "researched": 31,
    }

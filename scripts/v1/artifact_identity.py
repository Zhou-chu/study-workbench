"""Read-only bridge to the single Node artifact verifier; never builds implicitly."""

from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any


def verify_artifact(source_root: Path, artifact: Path) -> dict[str, Any]:
    source_root = source_root.absolute()
    artifact = artifact.absolute()
    script = source_root / "frontend/scripts/build-artifact.mjs"
    for target in (source_root, artifact, script):
        if any(part.is_symlink() for part in (target, *target.parents)):
            raise ValueError("Artifact verification paths must not contain symlinks")
    env = {
        key: value
        for key, value in os.environ.items()
        if key in {"PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ"}
    }
    try:
        result = subprocess.run(
            ["node", str(script), "--verify", str(artifact)],
            cwd=source_root / "frontend",
            env=env,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        if result.returncode != 0:
            raise ValueError
        identity = json.loads(result.stdout)
        required = {
            "manifest_sha256",
            "build_id",
            "source_sha256",
            "artifact_sha256",
            "generated_sha256",
            "claim",
        }
        if not isinstance(identity, dict) or set(identity) != required:
            raise ValueError
        for key in required - {"build_id", "claim"}:
            if not isinstance(identity[key], str) or not re.fullmatch(
                "[0-9a-f]{64}", identity[key]
            ):
                raise ValueError
        if identity["claim"] != "source-artifact-association-not-reproducibility":
            raise ValueError
        return identity
    except (OSError, ValueError, subprocess.SubprocessError):
        raise RuntimeError(
            "Frontend artifact verification failed; rebuild the isolated candidate"
        ) from None

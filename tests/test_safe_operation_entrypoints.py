"""Offline regression gates; never execute the historical lifecycle recipes."""

import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
BLOCKED = (
    "database start-all stop-all status worker-stop worker-restart "
    "docker-buildx-prepare docker-buildx-clean docker-buildx-reset "
    "docker-build-local docker-push docker-push-latest docker-release "
    "tag release-test release-stack release-stack-down dev full clean-cache"
).split()


class SafeOperationEntrypoints(unittest.TestCase):
    def test_no_global_process_matching_or_upstream_publish_defaults(self):
        source = (ROOT / "Makefile").read_text()
        self.assertNotRegex(source, r"\b(?:pkill|pgrep)\b")
        self.assertNotIn("lfnovo/", source)
        self.assertNotIn("git push", source)

    def test_root_compose_has_no_runnable_services(self):
        # JSON is valid Compose YAML; no YAML library or Docker interpolation needed.
        source = (ROOT / "docker-compose.yml").read_text()
        manifest = json.loads(source)
        self.assertEqual(manifest["services"], {})
        self.assertEqual(set(manifest), {"services", "x-studyworkbench-notice"})
        self.assertIn(
            "docs/v1/DOCKER_MIGRATION.md", manifest["x-studyworkbench-notice"]
        )
        self.assertIn("NOT runtime-accepted", manifest["x-studyworkbench-notice"])

    def test_blocked_targets_are_literal_failures_without_prerequisites(self):
        source = (ROOT / "Makefile").read_text()
        # Check before execution: even a regression must not run historical recipes.
        for target in BLOCKED:
            match = re.search(
                r"^" + re.escape(target) + r":([^\n]*)\n((?:\t[^\n]*\n)+)", source, re.M
            )
            assert match is not None, target
            self.assertEqual(match[1].strip(), "", target)
            recipe = match[2].splitlines()
            self.assertEqual(len(recipe), 2, target)
            self.assertRegex(recipe[0], r'^\t@echo "Blocked: [A-Za-z0-9 /.-]+" >&2$')
            self.assertEqual(recipe[1], "\t@exit 2", target)
        self.assertNotIn("$(shell", source)
        self.assertNotRegex(source, r"(?m)^\s*(?:-?include|sinclude)\s")
        with tempfile.TemporaryDirectory() as folder:
            work = Path(folder)
            shutil.copyfile(ROOT / "Makefile", work / "Makefile")
            # Only recording stubs are reachable; no real lifecycle/network tools.
            for name in (
                "docker pkill pgrep kill killall git uv npm npx node python bash "
                "curl wget sleep xargs"
            ).split():
                stub = work / name
                stub.write_text("#!/bin/sh\necho reached >> unexpected-tool\nexit 97\n")
                stub.chmod(0o700)
            for target in BLOCKED:
                result = subprocess.run(
                    ["/usr/bin/make", "--no-print-directory", target],
                    cwd=work,
                    env={"PATH": str(work), "SHELL": "/bin/sh"},
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
                self.assertNotEqual(result.returncode, 0, target)
                self.assertIn("Blocked:", result.stderr, target)
                self.assertIn("docs/v1/ENTRYPOINTS.md", result.stderr, target)
                self.assertNotIn("not found", result.stderr, target)
                self.assertFalse((work / "unexpected-tool").exists(), target)
            # The default target is also exercised, after its literal recipe guard.
            help_recipe = re.search(r"^help:\n((?:\t[^\n]*\n)+)", source, re.M)
            assert help_recipe is not None
            for line in help_recipe[1].splitlines():
                self.assertRegex(line, r'^\t@echo "[A-Za-z0-9 /.:;()_-]+"$')
            result = subprocess.run(
                ["/usr/bin/make", "--no-print-directory"],
                cwd=work,
                env={"PATH": str(work), "SHELL": "/bin/sh"},
                capture_output=True,
                text=True,
                timeout=5,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("docs/v1/ENTRYPOINTS.md", result.stdout)
            self.assertFalse((work / "unexpected-tool").exists())

    def test_default_is_help_not_a_service(self):
        source = (ROOT / "Makefile").read_text()
        self.assertIn(".DEFAULT_GOAL := help", source)


def _copied_makefile(tmp_path: Path, *, child_status: int = 0):
    """Execute only a guarded copy, with every external boundary recorded."""
    source = (ROOT / "Makefile").read_text()
    assert "$(shell" not in source
    assert not re.search(r"(?m)^\s*(?:-?include|sinclude)\s", source)
    recipe = re.search(r"^v1-check:([^\n]*)\n((?:\t[^\n]*\n)+)", source, re.M)
    assert recipe is not None
    assert not recipe[1].strip(), "v1-check must have no prerequisites"
    # A safety preflight, not permission to run the inherited install/test path.
    assert not re.search(
        r"\b(?:uv|npm|npx|node|docker|curl|wget|find|rm|pip|python)\b", recipe[2]
    ), "Refusing to execute an unsafe historical v1-check recipe"
    work = tmp_path / "synthetic checkout"
    work.mkdir()
    (work / "Makefile").write_text(source)
    tools = work / "tools"
    tools.mkdir()
    for name in (
        "docker pkill pgrep kill killall git uv npm npx node python python3 bash "
        "curl wget sleep xargs find rm pip pip3 install"
    ).split():
        stub = tools / name
        stub.write_text(
            '#!/bin/sh\nprintf "%s\\n" "$0" "$@" >> unexpected-tool\nexit 97\n'
        )
        stub.chmod(0o700)
    python = work / "prepared python"
    python.write_text(
        f'#!/bin/sh\nprintf "%s\\n" "$@" >> runner-arguments\nexit {child_status}\n'
    )
    python.chmod(0o700)
    cache = work / "prepared token cache"
    cache.mkdir()
    return work, tools, python, cache


def _make(work: Path, tools: Path, *arguments: str):
    return subprocess.run(
        ["/usr/bin/make", "--no-print-directory", *arguments],
        cwd=work,
        env={"PATH": str(tools), "SHELL": "/bin/sh"},
        capture_output=True,
        text=True,
        timeout=5,
    )


@pytest.mark.parametrize("missing", ["both", "python", "cache", "blank"])
def test_v1_check_requires_explicit_configuration_before_any_call(tmp_path, missing):
    work, tools, python, cache = _copied_makefile(tmp_path)
    arguments = {
        "both": [],
        "python": [f"TIKTOKEN_CACHE={cache}"],
        "cache": [f"OFFLINE_PYTHON={python}"],
        "blank": ["OFFLINE_PYTHON=   ", f"TIKTOKEN_CACHE={cache}"],
    }[missing]
    result = _make(work, tools, "v1-check", *arguments)
    assert result.returncode != 0
    assert "OFFLINE_PYTHON" in result.stderr
    assert "TIKTOKEN_CACHE" in result.stderr
    assert "docs/7-DEVELOPMENT/testing.md" in result.stderr
    assert not (work / "runner-arguments").exists()
    assert not (work / "unexpected-tool").exists()


@pytest.mark.parametrize(
    "invalid",
    ["python-missing", "python-not-executable", "python-unqualified", "cache"],
)
def test_v1_check_rejects_unprepared_paths_without_fallback(tmp_path, invalid):
    work, tools, python, cache = _copied_makefile(tmp_path)
    if invalid == "python-missing":
        python = work / "missing python"
    elif invalid == "python-not-executable":
        python.chmod(0o600)
    elif invalid == "python-unqualified":
        # The file validated in cwd must not accidentally select a PATH tool.
        shutil.copyfile(python, work / "python")
        (work / "python").chmod(0o700)
        python = Path("python")
    else:
        cache = work / "missing cache"
    result = _make(
        work, tools, "v1-check", f"OFFLINE_PYTHON={python}", f"TIKTOKEN_CACHE={cache}"
    )
    assert result.returncode != 0
    assert "docs/7-DEVELOPMENT/testing.md" in result.stderr
    assert not (work / "runner-arguments").exists()
    assert not (work / "unexpected-tool").exists()


@pytest.mark.parametrize("child_status", [0, 19])
def test_v1_check_delegates_only_to_runner_and_reports_narrow_scope(
    tmp_path, child_status
):
    work, tools, python, cache = _copied_makefile(tmp_path, child_status=child_status)
    result = _make(
        work, tools, "v1-check", f"OFFLINE_PYTHON={python}", f"TIKTOKEN_CACHE={cache}"
    )
    assert (work / "runner-arguments").read_text().splitlines() == [
        "scripts/offline_pytest.py",
        "--tiktoken-cache",
        str(cache),
    ]
    assert not (work / "unexpected-tool").exists()
    assert "backend offline gate" in result.stdout.lower()
    assert "NOT RUN by this target" in result.stdout
    for gate in ("Python static checks", "frontend", "coverage", "DB/runtime", "CI"):
        assert gate in result.stdout
    if child_status:
        assert result.returncode != 0
        assert "Error 19" in result.stderr  # GNU Make itself returns 2.
        assert "passed" not in result.stdout.lower()
        assert "success" not in result.stdout.lower()
    else:
        assert result.returncode == 0, result.stderr


def test_clean_cache_preserves_entire_synthetic_tree_and_symlink_target(tmp_path):
    source = (ROOT / "Makefile").read_text()
    recipe = re.search(r"^clean-cache:([^\n]*)\n((?:\t[^\n]*\n)+)", source, re.M)
    assert recipe is not None
    assert not recipe[1].strip()
    # Never invoke a historical recursive cleaner, even on a synthetic tree.
    assert re.fullmatch(
        r'\t@echo "Blocked: [A-Za-z0-9 /.-]+" >&2\n\t@exit 2\n', recipe[2]
    ), "Refusing to execute the historical cleanup recipe"
    work, tools, _, _ = _copied_makefile(tmp_path)
    for relative in (
        ".venv/module.pyd",
        ".venv/lib/__pycache__/native.pyc",
        "__pycache__/source.pyc",
        ".mypy_cache/state",
        ".ruff_cache/state",
        ".pytest_cache/state",
        ".runtime/state",
        "data/retained.pyo",
    ):
        sentinel = work / relative
        sentinel.parent.mkdir(parents=True, exist_ok=True)
        sentinel.write_bytes(b"retained synthetic bytes")
    outside = tmp_path / "outside synthetic sentinel.pyd"
    outside.write_bytes(b"retained symlink target")
    (work / "linked.pyd").symlink_to(outside)

    def snapshot():
        return {
            str(path.relative_to(work)): (
                ("symlink", str(path.readlink()))
                if path.is_symlink()
                else ("file", path.read_bytes())
                if path.is_file()
                else ("directory", "")
            )
            for path in work.rglob("*")
        }

    before = snapshot()
    result = _make(work, tools, "clean-cache")
    assert result.returncode == 2
    assert "Blocked:" in result.stderr
    assert "docs/v1/ENTRYPOINTS.md" in result.stderr
    assert snapshot() == before
    assert outside.read_bytes() == b"retained symlink target"


if __name__ == "__main__":
    unittest.main()

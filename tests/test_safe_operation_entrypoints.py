"""Offline regression gates; never execute the historical lifecycle recipes."""

import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BLOCKED = (
    "database start-all stop-all status worker-stop worker-restart "
    "docker-buildx-prepare docker-buildx-clean docker-buildx-reset "
    "docker-build-local docker-push docker-push-latest docker-release "
    "tag release-test release-stack release-stack-down dev full"
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


if __name__ == "__main__":
    unittest.main()

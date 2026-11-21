"""Read-only constraints on the Makefile and deprecated Compose file."""

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


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

    def test_default_is_help_not_a_service(self):
        source = (ROOT / "Makefile").read_text()
        self.assertIn(".DEFAULT_GOAL := help", source)

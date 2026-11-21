from __future__ import annotations

import unittest

from scripts.ci.sonar_reports import ReportError, normalize_cobertura, normalize_lcov

LCOV = b"TN:\nSF:src/index.ts\nFN:1,f\nFNDA:2,f\nDA:1,2\nBRDA:1,0,0,2\nLF:1\nLH:1\nend_of_record\n"
COBERTURA = b"""<coverage version="7.14.3" lines-valid="1" lines-covered="1"
 branches-valid="0" branches-covered="0"><sources><source>.</source></sources>
 <packages><package name="api"><classes><class name="test.py" filename="api/test.py">
 <lines><line number="1" hits="1"/></lines></class></classes></package></packages></coverage>"""


class SonarReportsTests(unittest.TestCase):
    def test_workspace_and_root_relative_paths_preserve_all_counters(self) -> None:
        source = LCOV
        self.assertEqual(
            normalize_lcov("domain", source, {"packages/domain/src/index.ts"}),
            source.replace(b"SF:src/index.ts", b"SF:packages/domain/src/index.ts"),
        )
        root = source.replace(b"src/index.ts", b"scripts/x.mjs")
        self.assertEqual(normalize_lcov("node-tools", root, {"scripts/x.mjs"}), root)

    def test_bad_lcov_is_rejected(self) -> None:
        for source in (
            b"",
            LCOV.replace(b"src/index.ts", b"../src/index.ts"),
            LCOV.replace(b"src/index.ts", b"/src/index.ts"),
            LCOV.replace(b"src/index.ts", b"src/unknown.ts"),
            LCOV + LCOV,
            LCOV.replace(b"DA:1,2", b"DA:bogus"),
            LCOV.removesuffix(b"end_of_record\n"),
        ):
            with self.subTest(source=source), self.assertRaises(ReportError):
                normalize_lcov("web", source, {"apps/web/src/index.ts"})

    def test_coverage_py_empty_and_dot_sources_are_one_root(self) -> None:
        source = COBERTURA.replace(
            b"<source>.</source>", b"<source/><source>.</source>"
        )
        normalized = normalize_cobertura(source, {"api/test.py"})
        self.assertEqual(normalized.count(b"<source>"), 1)
        self.assertIn(b"<source>.</source>", normalized)
        self.assertIn(b'<line number="1" hits="1"', normalized)

    def test_python_cobertura_is_not_junit(self) -> None:
        self.assertEqual(normalize_cobertura(COBERTURA, {"api/test.py"}), COBERTURA)
        for source in (
            b"<testsuites><testsuite name='pytest'/></testsuites>",
            COBERTURA.replace(b"api/test.py", b"unknown.py"),
            COBERTURA.replace(b"api/test.py", b"../api/test.py"),
            COBERTURA.replace(b"<source>.</source>", b"<source>/other</source>"),
            COBERTURA.replace(b'<line number="1" hits="1"/>', b""),
            COBERTURA.replace(b'lines-valid="1"', b'lines-valid="2"'),
            b"<!DOCTYPE coverage>" + COBERTURA,
        ):
            with self.subTest(source=source), self.assertRaises(ReportError):
                normalize_cobertura(source, {"api/test.py"})

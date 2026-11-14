"""Explicit mocked typed-500 UI fixture, NOT native upload/commit acceptance."""

import json
from pathlib import Path
from urllib.parse import quote, urlsplit


class TypedUnsafeBudget:
    """Finite metadata-only ledger. Never read request bodies or credentials."""

    def __init__(self, base: str, notebook: str):
        self.origin = urlsplit(base)
        assert self.origin.scheme == "http" and self.origin.hostname == "127.0.0.1"
        assert not self.origin.username and not self.origin.password
        self.notebook_url = base + "/api/personal/notebooks/" + quote(notebook, safe="")
        self.upload_url = self.notebook_url + "/sources/upload"
        self.workspace_url = self.notebook_url + "/workspace"
        self.posts = 0
        self.fulfilled = 0
        self.workspace_reads = 0
        self.violations: list[str] = []
        self.violation_overflow = 0

    def record_violation(self, code: str):
        if len(self.violations) < 16:
            self.violations.append(code)
        else:
            self.violation_overflow += 1

    def classify(self, method: str, url: str) -> str:
        parsed = urlsplit(url)
        if (parsed.scheme, parsed.netloc) != (self.origin.scheme, self.origin.netloc):
            self.record_violation("outside-origin")
            return "abort"
        if method == "POST" and url == self.upload_url:
            self.posts += 1
            if self.posts == 1:
                return "fulfill"
            self.record_violation("upload-budget-exceeded")
            return "abort"
        if method not in {"GET", "HEAD"}:
            self.record_violation("unexpected-write")
            return "abort"
        if method == "GET" and url == self.workspace_url:
            self.workspace_reads += 1
        return "fallback"

    def route(self, route, recheck):
        try:
            recheck()
            action = self.classify(route.request.method, route.request.url)
            if action == "fulfill":
                # Deliberately no fabricated source IDs or private server message.
                route.fulfill(
                    status=500,
                    content_type="application/json",
                    body=json.dumps(
                        {
                            "detail": {
                                "code": "UPLOAD_COMMIT_UNKNOWN",
                                "retry_safe": False,
                            }
                        }
                    ),
                )
                self.fulfilled += 1  # Sync Playwright has completed the fulfillment.
            elif action == "fallback":
                route.fallback()  # Retain the existing owned-origin route guard.
            else:
                route.abort()
        except Exception:
            self.record_violation("route-failure")
            route.abort()

    def assert_complete(self):
        assert (
            self.posts == self.fulfilled == 1
            and not self.violations
            and not self.violation_overflow
        ), self.receipt()

    def receipt(self):
        return {
            "scenario": "mocked-typed-500-ordinary-workbench",
            "upload_posts_intercepted": self.posts,
            "fulfilled_500": self.fulfilled,
            "workspace_gets": self.workspace_reads,
            "violations": list(self.violations),
            "violation_overflow": self.violation_overflow,
            "real_backend_uploads": 0,
            "backend_commit_proven": False,
            "scope": "same mounted workbench only; generic transport and remount untested",
        }


def run_typed_unsafe_fixture(page, guard, out: Path):
    """Call on original English desktop workbench, before restore/locale changes.

    Uses the existing public fixture path twice (same bytes/mtime/name/type), not
    synthetic JS dispatch or a new-file payload with a different lastModified.
    Retention is observed via blocked row, duplicate suppression and draft values;
    this does not inspect React memory or establish cross-remount persistence.
    """
    from playwright.sync_api import expect

    expected = guard.base + "/notebooks/" + quote(guard.notebook, safe="") + "/study"
    assert page.url == expected, "Typed fixture must use original owned notebook"
    assert page.viewport_size["width"] >= 1280, "English desktop fixture required"
    guard.assert_runtime()
    b = TypedUnsafeBudget(guard.base, guard.notebook)

    def handler(route):
        b.route(route, guard.assert_runtime)

    checkpoints = []
    phase = "prepare"
    page.route("**/*", handler)
    try:
        page.locator("#workbench-panel-conversation").get_by_role(
            "button", name="Conversation", exact=True
        ).click()
        page.locator("#workbench-question").fill(
            "Typed unsafe fixture: preserve question"
        )
        page.locator("#note-title").fill("Typed unsafe fixture draft")
        page.locator("#note-content").fill("Typed unsafe fixture: preserve note")
        upload = page.get_by_label("Upload files", exact=True)
        fixture = (
            Path(__file__).resolve().parents[2] / "tests/fixtures/v1/fixture_course.md"
        )
        phase = "typed-500"
        with page.expect_response(
            lambda r: r.request.method == "POST" and r.url == b.upload_url
        ) as response:
            upload.set_input_files(str(fixture))
        assert response.value.status == 500
        assert response.value.finished() is None
        blocked = page.get_by_role("status").filter(
            has_text="fixture_course.md: This upload may already be saved. Retrying is blocked."
        )

        def retained():
            expect(blocked).to_have_count(1)
            expect(blocked).to_be_visible()
            expect(
                page.get_by_role("button", name="Try this upload again", exact=True)
            ).to_have_count(0)
            expect(
                page.get_by_role("button", name="Dismiss upload notice", exact=True)
            ).to_have_count(0)
            expect(page.locator("#workbench-question")).to_have_value(
                "Typed unsafe fixture: preserve question"
            )
            expect(page.locator("#note-title")).to_have_value(
                "Typed unsafe fixture draft"
            )
            expect(page.locator("#note-content")).to_have_value(
                "Typed unsafe fixture: preserve note"
            )
            b.assert_complete()

        retained()
        checkpoints.append("typed-500-blocked-drafts-retained")
        phase = "same-file-repick"
        upload.set_input_files(str(fixture))
        # A bounded observation, not proof that no future request can ever occur.
        page.wait_for_timeout(500)
        retained()
        checkpoints.append("same-file-repick-no-additional-upload")
        phase = "readonly-refresh"
        reads = b.workspace_reads
        with page.expect_response(
            lambda r: r.request.method == "GET" and r.url == b.workspace_url
        ) as response:
            page.get_by_role(
                "button", name="Refresh sources to inspect", exact=True
            ).click()
        assert response.value.status == 200
        assert response.value.finished() is None
        expect(
            page.get_by_role("button", name="Refresh sources to inspect", exact=True)
        ).to_be_enabled()
        assert b.workspace_reads == reads + 1, (
            "Expected exactly one explicit workspace read"
        )
        retained()
        upload.set_input_files(str(fixture))
        page.wait_for_timeout(500)
        retained()
        checkpoints.append("readonly-refresh-does-not-unlock")
        page.screenshot(path=str(out / "typed-unsafe-fixture.png"), full_page=True)
        phase = "passed"
    finally:
        # Metadata only, even on failure; no exception strings, headers or bodies.
        (out / "typed-unsafe-fixture.json").write_text(
            json.dumps(
                {**b.receipt(), "phase": phase, "checkpoints": checkpoints}, indent=2
            )
        )
        page.unroute("**/*", handler)
    return {**b.receipt(), "phase": phase, "checkpoints": checkpoints}

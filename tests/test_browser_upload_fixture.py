"""Offline route-budget tests; no browser/server/provider is started."""

import importlib
from types import SimpleNamespace

import pytest


def budget():
    spec = importlib.util.find_spec("scripts.v1.browser_upload_fixture")
    assert spec is not None, "typed unsafe fixture budget missing"
    module = importlib.import_module("scripts.v1.browser_upload_fixture")
    return module.TypedUnsafeBudget("http://127.0.0.1:3300", "notebook:fixture")


def test_exact_one_post_and_completion():
    b = budget()
    assert b.classify("POST", b.upload_url) == "fulfill"
    with pytest.raises(AssertionError):
        b.assert_complete()
    b.fulfilled += 1
    b.assert_complete()
    assert b.classify("POST", b.upload_url) == "abort"
    with pytest.raises(AssertionError):
        b.assert_complete()


@pytest.mark.parametrize(
    "method,suffix",
    [
        ("PATCH", "/selection"),
        ("DELETE", ""),
        ("POST", "/sources/upload?extra=1"),
        ("PUT", "/sources/upload"),
    ],
)
def test_unexpected_writes_fail_persistently(method, suffix):
    b = budget()
    assert b.classify(method, b.notebook_url + suffix) == "abort"
    assert b.violations == ["unexpected-write"]


def test_outside_origin_and_wrong_notebook_fail_closed():
    b = budget()
    assert b.classify("GET", "https://example.invalid/private?token=secret") == "abort"
    assert (
        b.classify("POST", b.upload_url.replace("notebook%3Afixture", "other"))
        == "abort"
    )
    assert "secret" not in repr(b.receipt())
    assert "example.invalid" not in repr(b.receipt())


def test_reads_have_no_upload_budget_effect():
    b = budget()
    assert b.classify("GET", b.workspace_url) == "fallback"
    assert b.classify("GET", b.notebook_url + "/jobs") == "fallback"
    assert b.workspace_reads == 1
    assert b.posts == 0


def test_guard_rechecked_and_failed_fulfill_not_counted():
    b = budget()

    class Route:
        request = SimpleNamespace(method="POST", url=b.upload_url)

        def fulfill(self, **kwargs):
            assert kwargs["status"] == 500
            assert "retry_safe" in kwargs["body"]
            raise RuntimeError("synthetic fulfillment failure")

        def abort(self):
            self.aborted = True

    calls = []
    route = Route()
    b.route(route, lambda: calls.append("guard"))
    assert calls == ["guard"]
    assert route.aborted
    assert b.fulfilled == 0
    assert b.violations == ["route-failure"]


def test_route_never_reads_body_headers_or_logs_private_values():
    b = budget()

    class Request:
        method = "POST"
        url = b.upload_url

        @property
        def headers(self):
            raise AssertionError("headers must not be read")

        @property
        def post_data(self):
            raise AssertionError("body must not be read")

    class Route:
        request = Request()

        def fulfill(self, **kwargs):
            self.status = kwargs["status"]

        def abort(self):
            raise AssertionError("expected fulfillment")

    route = Route()
    b.route(route, lambda: None)
    b.assert_complete()
    assert route.status == 500
    assert b.receipt()["fulfilled_500"] == 1


def test_guard_failure_aborts_before_any_upload():
    b = budget()

    class Route:
        request = SimpleNamespace(method="POST", url=b.upload_url)
        aborted = False

        def abort(self):
            self.aborted = True

    def reject():
        raise RuntimeError("private token not logged")

    route = Route()
    b.route(route, reject)
    assert route.aborted and b.posts == 0
    assert "private" not in repr(b.receipt())


def test_violation_ledger_is_bounded_and_overflow_still_fails():
    b = budget()
    for _ in range(100):
        assert b.classify("DELETE", b.notebook_url) == "abort"
    assert len(b.violations) == 16
    assert b.receipt()["violation_overflow"] == 84
    assert b.receipt()["violations"] == ["unexpected-write"] * 16
    b.posts = b.fulfilled = 1
    with pytest.raises(AssertionError):
        b.assert_complete()

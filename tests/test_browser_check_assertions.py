"""Pure browser evidence assertions; no browser, server, or network execution."""

from copy import deepcopy
from types import SimpleNamespace

import pytest

from scripts.v1 import browser_check as check


def mobile():
    return {
        "viewport": 390,
        "document_width": 391,
        "main_width": 389,
        "panels": [{"width": 350, "content_width": 351, "client_width": 350}],
        "canvas": {"width": 300, "left": 0, "right": 390},
    }


def test_assertion_helpers_exist():
    assert callable(getattr(check, "validate_mobile_metrics", None))
    assert callable(getattr(check, "validate_viewport_metrics", None))
    assert callable(getattr(check, "validate_pdf_pixels", None))


@pytest.mark.parametrize("reader", [False, True])
def test_mobile_accepts_exact_tolerances_without_mutating_evidence(reader):
    metrics = mobile()
    before = deepcopy(metrics)
    check.validate_mobile_metrics(metrics, reader=reader)
    assert metrics == before


@pytest.mark.parametrize(
    "patch",
    [
        {"viewport": 391},
        {"document_width": 392},
        {"main_width": 388},
        {"panels": []},
        {"panels": [{"width": 349, "content_width": 350, "client_width": 350}]},
        {"panels": [{"width": 350, "content_width": 352, "client_width": 350}]},
        {"canvas": None},
        {"canvas": {"width": 299, "left": 0, "right": 390}},
        {"canvas": {"width": 300, "left": -1, "right": 390}},
        {"canvas": {"width": 300, "left": 390, "right": 390}},
        {"canvas": {"width": 300, "left": 0, "right": 391}},
    ],
)
def test_mobile_rejects_invalid_geometry_with_original_evidence(patch):
    metrics = mobile() | patch
    with pytest.raises(AssertionError) as exc:
        check.validate_mobile_metrics(metrics, reader=True)
    assert exc.value.args == (metrics,)


def test_nonreader_does_not_require_canvas():
    check.validate_mobile_metrics(mobile() | {"canvas": None})


@pytest.mark.parametrize(
    "document,body,valid", [(845, 845, True), (846, 844, False), (844, 846, False)]
)
def test_viewport_overflow_tolerance(document, body, valid):
    metrics = {"viewport": 844, "document_height": document, "body_height": body}
    if valid:
        check.validate_viewport_metrics(metrics)
    else:
        with pytest.raises(AssertionError) as exc:
            check.validate_viewport_metrics(metrics)
        assert exc.value.args == (metrics,)


@pytest.mark.parametrize("pixels,valid", [(0, False), (100, False), (101, True)])
def test_pdf_raster_threshold(pixels, valid):
    if valid:
        check.validate_pdf_pixels(pixels)
    else:
        with pytest.raises(AssertionError, match="Blank PDF raster"):
            check.validate_pdf_pixels(pixels)


@pytest.mark.parametrize(
    "method,url,status,expected",
    [
        ("GET", "http://fixture/", 200, True),
        ("GET", "http://fixture/", 299, True),
        ("POST", "http://fixture/", 200, False),
        ("GET", "http://other/", 200, False),
        ("GET", "http://fixture/", 199, False),
        ("GET", "http://fixture/", 300, False),
    ],
)
def test_response_requires_exact_method_url_and_success_status(
    method, url, status, expected
):
    response = SimpleNamespace(
        request=SimpleNamespace(method=method), url=url, status=status
    )
    assert check.successful_response(response, "GET", "http://fixture/") is expected


@pytest.mark.parametrize(
    "url,runtime_ok,allowed",
    [
        ("http://127.0.0.1:18864/path", True, True),
        ("http://127.0.0.1:18864/path", False, False),
        ("https://127.0.0.1:18864/path", True, False),
        ("http://127.0.0.1:18865/path", True, False),
        ("http://127.0.0.1:18864.evil/path", True, False),
    ],
)
def test_origin_guard_aborts_without_continuing_on_boundary_failure(
    url, runtime_ok, allowed
):
    events = []

    def assert_runtime():
        events.append("runtime")
        if not runtime_ok:
            raise RuntimeError("owned runtime stopped")

    guard = SimpleNamespace(
        data={"ports": {"frontend": 18864}}, assert_runtime=assert_runtime
    )
    route = SimpleNamespace(
        request=SimpleNamespace(url=url),
        abort=lambda: events.append("abort"),
        continue_=lambda: events.append("continue"),
    )
    if allowed:
        check.route_owned_request(guard, route)
        assert events == ["runtime", "continue"]
    else:
        with pytest.raises(RuntimeError):
            check.route_owned_request(guard, route)
        assert events[-1] == "abort"
        assert "continue" not in events

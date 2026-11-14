"""Direct logical-unit cases extracted without changing assertions or parameters."""

from types import SimpleNamespace

from scripts.v1 import browser_check


def test_exact_success_response_rejects_wrong_method_origin_path_and_error():
    target = "http://127.0.0.1:1234/api/personal/notebooks/n/selection"
    match = getattr(browser_check, "successful_response", None)
    assert callable(match), "exact successful response predicate missing"

    def response(method, url, status):
        return SimpleNamespace(
            request=SimpleNamespace(method=method), url=url, status=status
        )

    assert match(response("PATCH", target, 200), "PATCH", target)
    for method, url, status in [
        ("GET", target, 200),
        ("PATCH", target + "?x=1", 200),
        ("PATCH", target.replace("1234", "1235"), 200),
        ("PATCH", target, 500),
    ]:
        assert not match(response(method, url, status), "PATCH", target)

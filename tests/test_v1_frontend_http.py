"""HTTP-only acceptance guards; no services, sockets or browser."""

from unittest.mock import Mock

import httpx
import pytest

from scripts.v1 import local_check


def test_http_rejects_stale_artifact_before_ports(monkeypatch, tmp_path):
    monkeypatch.setattr(
        "sys.argv", ["local_check", "--frontend-http", "--artifact", str(tmp_path)]
    )
    monkeypatch.setattr(
        local_check, "verify_artifact", Mock(side_effect=RuntimeError("stale"))
    )
    ports = Mock()
    monkeypatch.setattr(local_check, "select_unused_ports", ports)
    with pytest.raises(RuntimeError, match="stale"):
        local_check.main()
    ports.assert_not_called()


def test_frontend_environment_excludes_backend_credentials(tmp_path):
    backend = local_check.build_fixture_environment(tmp_path, {"PATH": "/bin"})
    env = local_check.build_frontend_environment(backend, 12345)
    assert env["PORT"] == "12345"
    assert env["HOSTNAME"] == "127.0.0.1"
    assert env["INTERNAL_API_URL"] == backend["INTERNAL_API_URL"]
    assert env["API_URL"] == backend["API_URL"]
    assert not any("PASSWORD" in k or "SURREAL" in k or "ENCRYPTION" in k for k in env)


@pytest.mark.parametrize("bad", ["", "static", "auth", "config"])
def test_http_probe_exact_bytes_and_auth(tmp_path, bad):
    static = tmp_path / ".next/static/chunks/a.js"
    static.parent.mkdir(parents=True)
    static.write_bytes(b"public static fixture")
    calls = []

    def handle(request):
        calls.append(request)
        if request.url.path == "/config":
            return httpx.Response(
                200,
                json={
                    "apiUrl": "http://127.0.0.1:12345"
                    if bad != "config"
                    else "http://foreign",
                    "auth_mode": "legacy_password",
                    "web_session_protocol": None,
                },
            )
        if request.url.path.startswith("/_next/static/"):
            return httpx.Response(
                200, content=b"wrong" if bad == "static" else static.read_bytes()
            )
        if request.headers.get("Authorization") != "Bearer fixture-only":
            return httpx.Response(200 if bad == "auth" else 401)
        return httpx.Response(200, json={"id": "notebook:fixture"})

    with httpx.Client(
        base_url="http://127.0.0.1:12345", transport=httpx.MockTransport(handle)
    ) as client:
        if bad:
            with pytest.raises(AssertionError):
                local_check.probe_frontend_http(
                    client,
                    tmp_path,
                    "http://127.0.0.1:12345",
                    "fixture-only",
                    "notebook:fixture",
                )
        else:
            local_check.probe_frontend_http(
                client,
                tmp_path,
                "http://127.0.0.1:12345",
                "fixture-only",
                "notebook:fixture",
            )
            assert len(calls) >= 4

"""Direct version utility units: transport and package metadata are replaced."""

from importlib.metadata import PackageNotFoundError
from types import SimpleNamespace

import httpx
import pytest
from packaging.version import InvalidVersion

from open_notebook.utils import version_utils as subject


@pytest.mark.parametrize(
    "left,right,expected",
    [
        ("1.2.3", "1.2.3", 0),
        ("1.0", "2.0", -1),
        ("2.0", "1.0", 1),
        ("1.0rc1", "1.0", -1),
        ("1.0.post1", "1.0", 1),
        ("1.0", "1.0.0", 0),
    ],
)
def test_version_ordering(left, right, expected):
    assert subject.compare_versions(left, right) == expected


@pytest.mark.parametrize("left,right", [("not-version", "1"), ("1", "bad!")])
def test_invalid_version_is_not_silently_coerced(left, right):
    with pytest.raises(InvalidVersion):
        subject.compare_versions(left, right)


def test_installed_version_uses_injected_metadata_only(monkeypatch):
    calls = []

    def lookup(name):
        calls.append(name)
        return "2.3.4"

    monkeypatch.setattr(subject, "version", lookup)
    assert subject.get_installed_version("synthetic-package") == "2.3.4"
    assert calls == ["synthetic-package"]


def test_missing_installed_package_preserves_domain_error(monkeypatch):
    def missing(_name):
        raise PackageNotFoundError("synthetic-package")

    monkeypatch.setattr(subject, "version", missing)
    with pytest.raises(PackageNotFoundError, match="synthetic-package"):
        subject.get_installed_version("synthetic-package")


@pytest.fixture
def transport(monkeypatch):
    state = SimpleNamespace(text="", calls=[], error=None, exits=[])

    class Response:
        @property
        def text(self):
            return state.text

        def raise_for_status(self):
            if state.error is not None:
                raise state.error

    def get(url, *, timeout):
        state.calls.append((url, timeout))
        return Response()

    class Client:
        def __init__(self, *, timeout):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, kind, value, traceback):
            state.exits.append(kind)

        async def get(self, url):
            return get(url, timeout=self.timeout)

    monkeypatch.setattr(subject.requests, "get", get)
    monkeypatch.setattr(httpx, "AsyncClient", Client)
    return state


async def invoke(mode, url="https://github.com/synthetic/project", branch="topic"):
    if mode == "async":
        return await subject.get_version_from_github_async(url, branch)
    return subject.get_version_from_github(url, branch)


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["sync", "async"])
@pytest.mark.parametrize(
    "document,expected",
    [
        ('[tool.poetry]\nversion="1.2.3"', "1.2.3"),
        ('[project]\nversion="2.0"', "2.0"),
        ('[tool.poetry]\nversion="3"\n[project]\nversion="4"', "3"),
    ],
)
async def test_remote_version_returns_parsed_value_and_exact_request(
    mode, document, expected, transport
):
    transport.text = document
    assert await invoke(mode) == expected
    assert transport.calls == [
        ("https://raw.githubusercontent.com/synthetic/project/topic/pyproject.toml", 10)
    ]
    if mode == "async":
        assert transport.exits == [None]


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["sync", "async"])
@pytest.mark.parametrize(
    "url,reason",
    [
        ("https://example.invalid/repo", "Not a GitHub URL"),
        ("https://github.com/", "Invalid GitHub repository URL"),
    ],
)
async def test_invalid_url_fails_before_transport(mode, url, reason, transport):
    with pytest.raises(ValueError, match=reason):
        await invoke(mode, url)
    assert transport.calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["sync", "async"])
async def test_missing_toml_version_remains_explicit(mode, transport):
    transport.text = '[project]\nname="synthetic"'
    with pytest.raises(KeyError, match="Version not found"):
        await invoke(mode)


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["sync", "async"])
async def test_invalid_toml_is_not_replaced_with_a_version(mode, transport):
    transport.text = "[unterminated"
    with pytest.raises(subject.tomli.TOMLDecodeError):
        await invoke(mode)


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["sync", "async"])
async def test_http_status_failure_is_not_retried_or_parsed(mode, transport):
    transport.text = "[invalid"
    transport.error = RuntimeError("synthetic HTTP failure")
    with pytest.raises(RuntimeError, match="synthetic HTTP failure"):
        await invoke(mode)
    assert len(transport.calls) == 1
    if mode == "async":
        assert transport.exits == [RuntimeError]

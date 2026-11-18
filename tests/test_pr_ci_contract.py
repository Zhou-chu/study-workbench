"""CI structure and bootstrap fixture contracts; filesystem/tool tests, not unit."""

import hashlib
import importlib.util
import io
import subprocess
import sys
import tarfile
from pathlib import Path

import pytest
import yaml  # type: ignore[import-untyped]  # Runtime parser is locked; stub package is not.

ROOT = Path(__file__).resolve().parents[1]


def bootstrap():
    path = ROOT / "scripts/ci/prepare_tools.py"
    assert path.is_file(), "CI bootstrap must exist"
    spec = importlib.util.spec_from_file_location("ci_prepare_review", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_download_bytes_reject_tampering_and_oversize():
    m = bootstrap()
    digest = hashlib.sha256(b"known").hexdigest()
    assert m.verify_bytes(b"known", digest, 5) == b"known"
    with pytest.raises(ValueError):
        m.verify_bytes(b"wrong", digest, 5)
    with pytest.raises(ValueError):
        m.verify_bytes(b"known", digest, 4)


def test_preexisting_workspace_is_not_reused(tmp_path):
    m = bootstrap()
    target = tmp_path / "owned"
    m.create_owned(target)
    marker = target / "preserve"
    marker.write_text("original")
    with pytest.raises(FileExistsError):
        m.create_owned(target)
    assert marker.read_text() == "original"


@pytest.mark.parametrize(
    "name,link", [("../escape", False), ("/absolute", False), ("git-2.56.1/link", True)]
)
def test_source_archive_rejects_escape_or_links(tmp_path, name, link):
    m = bootstrap()
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w:xz") as archive:
        member = tarfile.TarInfo(name)
        if link:
            member.type = tarfile.SYMTYPE
            member.linkname = "/tmp/outside"
        archive.addfile(member)
    with pytest.raises(ValueError):
        m.extract_source(stream.getvalue(), tmp_path)
    assert list(tmp_path.iterdir()) == []


def test_archive_valid_fixture_extracts_only_expected_root(tmp_path):
    m = bootstrap()
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w:xz") as archive:
        member = tarfile.TarInfo("git-2.56.1/README")
        member.size = 3
        archive.addfile(member, io.BytesIO(b"abc"))
    m.extract_source(stream.getvalue(), tmp_path)
    assert (tmp_path / "git-2.56.1/README").read_bytes() == b"abc"


def test_workflow_permissions_and_independent_gates():
    path = ROOT / ".github/workflows/pr-quality.yml"
    assert path.is_file(), "PR candidate workflow must exist"
    text = path.read_text()
    workflow = yaml.load(text, Loader=yaml.BaseLoader)
    assert set(workflow["on"]) == {"pull_request", "workflow_dispatch"}
    assert workflow["on"]["pull_request"]["branches"] == ["main"]
    assert workflow["permissions"] == {"contents": "read"}
    jobs = workflow["jobs"]
    assert set(jobs) == {"static", "mixed", "strict-unit", "sonar-coverage", "sonar"}
    assert {name: job["needs"] for name, job in jobs.items() if "needs" in job} == {
        "sonar": "sonar-coverage"
    }
    for job in jobs.values():
        assert "permissions" not in job
        assert job["runs-on"] == "ubuntu-24.04"
        for step in job["steps"]:
            assert "continue-on-error" not in step
            if "uses" in step:
                sha = step["uses"].split("@")[1]
                assert len(sha) == 40 and all(c in "0123456789abcdef" for c in sha)
                if step["uses"].startswith("actions/checkout@"):
                    assert step["with"]["persist-credentials"] == "false"
    assert "pull_request_target" not in text
    pr_scope = (
        "github.event_name == 'pull_request' && "
        "github.repository == 'Zhou-chu/study-workbench' && "
        "github.event.pull_request.head.repo.full_name == github.repository && "
        "github.event.pull_request.base.ref == 'main' && "
        "github.event.pull_request.number == 1"
    )
    assert jobs["sonar-coverage"]["if"] == pr_scope
    assert jobs["sonar"]["if"] == "${{ !cancelled() && " + pr_scope + " }}"
    for name in ("sonar-coverage", "sonar"):
        assert jobs[name]["steps"][0]["with"]["ref"] == (
            "${{ github.event.pull_request.head.sha }}"
        )
    assert jobs["sonar"]["steps"][0]["with"]["fetch-depth"] == "0"
    scan, summary = jobs["sonar"]["steps"][-2:]
    assert scan["uses"].startswith("SonarSource/sonarqube-scan-action@")
    assert scan["env"] == {"SONAR_TOKEN": "${{ secrets.SONAR_TOKEN }}"}
    assert scan["id"] == "sonar_scan"
    assert [
        step
        for job in jobs.values()
        for step in job["steps"]
        if "SONAR_TOKEN" in step.get("env", {})
    ] == [scan, summary]
    assert summary["env"]["SONAR_TOKEN"] == scan["env"]["SONAR_TOKEN"]
    assert summary["env"]["SONAR_RECEIPT"] in scan["with"]["args"]
    assert "-Dsonar.scanner.metadataFilePath=" in scan["with"]["args"]
    assert "steps.sonar_scan.outcome == 'failure'" in summary["if"]
    assert "!cancelled()" in summary["if"]
    assert "scripts/ci/sonar_gate.py" in summary["run"]
    assert text.count("secrets.") == 2 and text.count("SONAR_TOKEN:") == 2
    assert "-Dsonar.qualitygate.wait=true" in scan["with"]["args"]
    strict = "\n".join(
        x.get("run", "") for x in workflow["jobs"]["strict-unit"]["steps"]
    )
    assert "scripts/coverage-unit-all.mjs" in strict
    assert "|| true" not in strict and "continue-on-error" not in text
    mixed = "\n".join(x.get("run", "") for x in workflow["jobs"]["mixed"]["steps"])
    assert "scripts/offline_pytest.py" in mixed and "npm run coverage" in mixed
    static = "\n".join(x.get("run", "") for x in workflow["jobs"]["static"]["steps"])
    for command in [
        "ruff check .",
        "ruff format --check .",
        "mypy .",
        "npm run lint",
        "npm run typecheck",
        "npm --prefix frontend run lint",
        "tsc --noEmit",
    ]:
        assert command in static


def test_official_source_relative_internal_symlink_is_accepted(tmp_path):
    m = bootstrap()
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w:xz") as archive:
        member = tarfile.TarInfo("git-2.56.1/RelNotes")
        member.type = tarfile.SYMTYPE
        member.linkname = "Documentation/RelNotes/2.56.1.adoc"
        archive.addfile(member)
    m.extract_source(stream.getvalue(), tmp_path)
    link = tmp_path / "git-2.56.1/RelNotes"
    assert link.is_symlink()
    assert link.readlink().as_posix() == "Documentation/RelNotes/2.56.1.adoc"


def test_http_download_rejected_before_network():
    with pytest.raises(ValueError, match="HTTPS required"):
        bootstrap().download("http://example.invalid", "0" * 64)


def test_mixed_measurement_requires_preparation_but_not_python_success():
    text = (ROOT / ".github/workflows/pr-quality.yml").read_text()
    assert "&id001" not in text and "*id001" not in text
    document = yaml.load(text, Loader=yaml.BaseLoader)
    steps = document["jobs"]["mixed"]["steps"]
    ids = {step.get("id") for step in steps}
    assert {"dependencies", "prepare"} <= ids
    javascript = next(step for step in steps if step.get("run") == "npm run coverage")
    condition = javascript["if"]
    assert "!cancelled()" in condition
    assert "steps.dependencies.outcome == 'success'" in condition
    assert "steps.prepare.outcome == 'success'" in condition
    assert "python" not in condition


@pytest.mark.parametrize("has_report_directory", [False, True])
def test_coverage_dependency_import_group_ignores_generated_reports(
    tmp_path, has_report_directory
):
    (tmp_path / "pyproject.toml").write_bytes((ROOT / "pyproject.toml").read_bytes())
    script = tmp_path / "scripts/quality/unit_pytest_evidence.py"
    script.parent.mkdir(parents=True)
    script.write_bytes((ROOT / "scripts/quality/unit_pytest_evidence.py").read_bytes())
    if has_report_directory:
        report = tmp_path / "coverage/web/report.json"
        report.parent.mkdir(parents=True)
        report.write_text("{}")
    result = subprocess.run(
        [sys.executable, "-m", "ruff", "check", "--select", "I", str(script)],
        cwd=tmp_path,
        text=True,
        capture_output=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_frontend_static_requires_dependencies_but_not_python_success():
    document = yaml.load(
        (ROOT / ".github/workflows/pr-quality.yml").read_text(), Loader=yaml.BaseLoader
    )
    steps = document["jobs"]["static"]["steps"]
    dependency = next(step for step in steps if step.get("id") == "dependencies")
    python = next(step for step in steps if step.get("name") == "Python static checks")
    frontend = next(
        step
        for step in steps
        if step.get("name") == "Workspace and legacy frontend checks"
    )
    assert steps.index(dependency) < steps.index(python) < steps.index(frontend)
    assert frontend.get("if") == (
        "${{ !cancelled() && steps.dependencies.outcome == 'success' }}"
    )
    assert "continue-on-error" not in python
    assert "continue-on-error" not in frontend
    assert "|| true" not in python["run"]
    assert "|| true" not in frontend["run"]

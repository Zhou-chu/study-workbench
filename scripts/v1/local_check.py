"""Isolated real-stack checks, no Google/model calls. All processes share one sandbox."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import tempfile
import time
from collections.abc import Mapping
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]


def build_fixture_environment(
    run: Path, inherited_env: Mapping[str, str]
) -> dict[str, str]:
    # Do not let a host's provider/session environment enter the fixture stack.
    inherited = {
        key: value
        for key, value in inherited_env.items()
        if not any(
            marker in key.upper()
            for marker in ("API_KEY", "TOKEN", "SECRET", "PASSWORD", "ENCRYPTION_KEY")
        )
        and not key.startswith(("GOOGLE_", "NOTEBOOKLM_"))
    }
    return {
        **inherited,
        "PYTHON_DOTENV_DISABLED": "1",
        "SURREAL_URL": "ws://127.0.0.1:18000/rpc",
        "SURREAL_USER": "root",
        "SURREAL_PASSWORD": "test-only-local-fixture",
        "SURREAL_NAMESPACE": "v1_check",
        "SURREAL_DATABASE": "v1_check",
        "OPEN_NOTEBOOK_PASSWORD": "test-only-local-fixture",
        "STUDY_WORKBENCH_PRIVATE_MODE": "1",
        "OPEN_NOTEBOOK_ENCRYPTION_KEY": "test-only-encryption-fixture",
        "STUDY_WORKBENCH_DATA_DIR": str(run / "personal"),
        "OPEN_NOTEBOOK_DATA_DIR": str(run / "upstream-data"),
        "CORS_ORIGINS": "http://127.0.0.1:13000",
        "INTERNAL_API_URL": "http://127.0.0.1:5055",
        "API_URL": "http://127.0.0.1:13000",
        "UV_CACHE_DIR": "/tmp/sw-uv-cache",
        "NOTEBOOKLM_HOME": str(run / "no-google-profile"),
        "NOTEBOOKLM_STORAGE_PATH": str(run / "no-google-profile/storage_state.json"),
        "TZ": "UTC",
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--browser", action="store_true")
    args = parser.parse_args()
    run = Path(tempfile.mkdtemp(prefix="check-", dir=ROOT / ".runtime"))
    env = build_fixture_environment(run, os.environ)
    procs = []
    handles = []
    results = []
    navigation_cases = []

    def start(name, args):
        output = (run / (name + ".log")).open("w")
        handles.append(output)
        p = subprocess.Popen(
            args, cwd=ROOT, env=env, stdout=output, stderr=subprocess.STDOUT
        )
        procs.append(p)
        return p

    def wait_url(url):
        for _ in range(180):
            try:
                if httpx.get(url, timeout=1).status_code < 500:
                    return
            except httpx.HTTPError:
                pass
            time.sleep(0.5)
        raise RuntimeError("Service never became healthy: " + url)

    try:
        start(
            "db",
            [
                str(ROOT / ".runtime/bin/surreal"),
                "start",
                "--bind",
                "127.0.0.1:18000",
                "--user",
                "root",
                "--pass",
                "test-only-local-fixture",
                "--log",
                "warn",
                "rocksdb:" + str(run / "db"),
            ],
        )
        wait_url("http://127.0.0.1:18000/health")
        api = start(
            "api",
            [
                str(ROOT / ".venv/bin/python"),
                "-m",
                "uvicorn",
                "api.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                "5055",
            ],
        )
        wait_url("http://127.0.0.1:5055/health")
        start(
            "worker",
            [
                str(ROOT / ".venv/bin/surreal-commands-worker"),
                "--import-modules",
                "commands",
                "--max-tasks",
                "2",
            ],
        )
        with httpx.Client(
            base_url="http://127.0.0.1:5055",
            headers={"Authorization": "Bearer test-only-local-fixture"},
            timeout=20,
        ) as client:
            for path in [
                "/api/personal/jobs/x",
                "/api/personal/source-versions/x/download",
                "/api/personal/exports/x/download",
            ]:
                r = httpx.get("http://127.0.0.1:5055" + path)
                assert r.status_code == 401, (path, r.status_code)
            results.append(
                "Anonymous API, original, task and export requests rejected with 401"
            )
            r = client.post(
                "/api/notebooks",
                json={
                    "name": "V1 public fixture",
                    "description": "Isolated real-stack verification",
                },
            )
            r.raise_for_status()
            nb = r.json()["id"]
            fixture = ROOT / "tests/fixtures/v1/fixture_course.md"
            if not fixture.exists():
                fixture.write_text("# 测试\n\n证据是可检验的原始材料。\n")
            content = fixture.read_bytes()
            upload_data = {"idempotency_key": "upload-once"}
            upload_files = {"file": (fixture.name, content, "text/markdown")}
            r = client.post(
                f"/api/personal/notebooks/{nb}/sources/upload",
                data=upload_data,
                files=upload_files,
            )
            r.raise_for_status()
            upload = r.json()
            duplicate = client.post(
                f"/api/personal/notebooks/{nb}/sources/upload",
                data=upload_data,
                files=upload_files,
            )
            duplicate.raise_for_status()
            assert duplicate.json() == upload
            for _ in range(120):
                r = client.get(f"/api/personal/notebooks/{nb}/workspace")
                r.raise_for_status()
                workspace = r.json()
                job = next(
                    j for j in workspace["jobs"] if j["job_id"] == upload["job_id"]
                )
                if job["state"] in ("succeeded", "failed"):
                    break
                time.sleep(0.5)
            assert job["state"] == "succeeded", job
            detail = client.get(
                "/api/personal/source-versions/" + upload["source_version_id"]
            )
            detail.raise_for_status()
            detail = detail.json()
            assert detail["extraction"]["status"] == "ready", detail
            original = client.get(
                "/api/personal/source-versions/"
                + upload["source_version_id"]
                + "/download"
            )
            original.raise_for_status()
            assert original.content == content
            results.append(
                "Real native DB/API/worker upload, CPU extraction, idempotency and original hash verified"
            )
            evidence = detail["evidence"][0]
            assert evidence["quote"]
            search = client.post(
                "/api/personal/search",
                json={
                    "query": evidence["quote"][:20],
                    "source_version_ids": [upload["source_version_id"]],
                },
            )
            search.raise_for_status()
            assert search.json()["hits"]
            note = client.post(
                f"/api/personal/notebooks/{nb}/notes",
                json={
                    "title": "Saved evidence",
                    "content": "Retained public test note",
                    "citations": [],
                    "scope_snapshot": {
                        "source_version_ids": [upload["source_version_id"]]
                    },
                },
            )
            note.raise_for_status()
            selection = {
                "engine": "independent",
                "selection_origin": "local",
                "source_version_ids": [upload["source_version_id"]],
                "remote_source_ids": [],
                "reading": {
                    "source_version_id": upload["source_version_id"],
                    "page_index": 0,
                },
            }
            client.patch(
                f"/api/personal/notebooks/{nb}/selection", json=selection
            ).raise_for_status()
            results.append(
                "Real lexical search, note save and persistent selection verified without a model"
            )
            # Real CPU PDF/TXT and explicit failure states, still no model/provider.
            for filename, mime, expected_status, expected_pages in [
                ("fixture_a.pdf", "application/pdf", "ready", 3),
                ("fixture_b.pdf", "application/pdf", "ready", 4),
                ("fixture_scanned.pdf", "application/pdf", "needs_ocr", 1),
                ("fixture_invalid.pdf", "application/pdf", "failed", None),
                ("fixture_text.txt", "text/plain", "ready", None),
            ]:
                raw = (
                    (ROOT / "tests/fixtures/v1" / filename).read_bytes()
                    if filename != "fixture_text.txt"
                    else "真实 TXT 解析测试。证据必须来自原件。".encode()
                )
                uploaded = client.post(
                    f"/api/personal/notebooks/{nb}/sources/upload",
                    data={"idempotency_key": filename},
                    files={"file": (filename, raw, mime)},
                )
                uploaded.raise_for_status()
                vid = uploaded.json()["source_version_id"]
                jid = uploaded.json()["job_id"]
                for _ in range(120):
                    current = client.get(f"/api/personal/jobs/{jid}")
                    current.raise_for_status()
                    if current.json()["state"] in {"succeeded", "failed"}:
                        break
                    time.sleep(0.5)
                parsed = client.get(f"/api/personal/source-versions/{vid}")
                parsed.raise_for_status()
                parsed = parsed.json()
                assert parsed["extraction"]["status"] == expected_status, parsed
                assert parsed["extraction"].get("page_count") == expected_pages, parsed
                downloaded = client.get(f"/api/personal/source-versions/{vid}/download")
                downloaded.raise_for_status()
                assert downloaded.content == raw
                if expected_status == "needs_ocr":
                    assert parsed["extraction"]["warnings"] and not parsed["evidence"]
                if expected_pages and expected_status == "ready":
                    assert {
                        e["locator"]["page_index"] for e in parsed["evidence"]
                    } == set(range(expected_pages))
                if filename in {"fixture_a.pdf", "fixture_b.pdf"}:
                    references = []
                    records = parsed["evidence"]
                    for index in range(5):
                        record = records[index % len(records)]
                        # Distinct known references include exact subquotes, not model claims.
                        quote = record["quote"]
                        if index >= len(records):
                            quote = next(
                                line for line in quote.splitlines() if line.strip()
                            )
                        citation_id = f"LOC_{filename[8]}_{index + 1}"
                        references.append(
                            {
                                **record,
                                "citation_id": citation_id,
                                "kind": "local_evidence",
                                "quote": quote,
                            }
                        )
                        navigation_cases.append(
                            {
                                "source_title": filename,
                                "source_version_id": vid,
                                "citation_id": citation_id,
                                "physical_page": record["locator"]["page_index"] + 1,
                                "quote": quote,
                            }
                        )
                    checked = client.post(
                        f"/api/personal/notebooks/{nb}/notes",
                        json={
                            "title": f"Known locations: {filename}",
                            "content": "Five public known-reference fixtures, authored without a model.",
                            "citations": references,
                            "scope_snapshot": {"source_version_ids": [vid]},
                        },
                    )
                    checked.raise_for_status()
                    assert all(
                        c["reference_validity"] == "verified"
                        for c in checked.json()["citations"]
                    ), checked.json()
                if filename == "fixture_a.pdf":
                    citation = next(
                        e for e in parsed["evidence"] if e["locator"]["page_index"] == 2
                    )
                    citation = {
                        **citation,
                        "citation_id": "PDF_NAV",
                        "kind": "local_evidence",
                    }
                    nav_note = client.post(
                        f"/api/personal/notebooks/{nb}/notes",
                        json={
                            "title": "PDF navigation fixture",
                            "content": "Public authored note for physical-page navigation; no model answer.",
                            "citations": [citation],
                            "scope_snapshot": {"source_version_ids": [vid]},
                        },
                    )
                    nav_note.raise_for_status()
            results.append(
                "Real Chinese PDF (3+4 pages), TXT, image-only PDF needs_ocr and malformed PDF failed states verified; all original bytes preserved"
            )
            api.terminate()
            api.wait(10)
            api = start(
                "api-restarted",
                [
                    str(ROOT / ".venv/bin/python"),
                    "-m",
                    "uvicorn",
                    "api.main:app",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    "5055",
                ],
            )
            wait_url("http://127.0.0.1:5055/health")
            restored = client.get(f"/api/personal/notebooks/{nb}/workspace")
            restored.raise_for_status()
            restored = restored.json()
            assert (
                restored["selection"]["source_version_ids"]
                == selection["source_version_ids"]
            )
            assert any(
                n["content"] == "Retained public test note" for n in restored["notes"]
            )
            assert (
                client.get(
                    "/api/personal/source-versions/"
                    + upload["source_version_id"]
                    + "/download"
                ).content
                == content
            )
            results.append(
                "API process restart retains original bytes, evidence, note and selection in real native DB"
            )
            (run / "api-results.json").write_text(
                json.dumps(
                    {"status": "passed", "results": results},
                    ensure_ascii=False,
                    indent=2,
                )
            )
            (run / "navigation-cases.json").write_text(
                json.dumps(navigation_cases, ensure_ascii=False, indent=2)
            )
            if args.browser:
                standalone = ROOT / "frontend/.next/standalone"
                shutil.copytree(
                    ROOT / "frontend/.next/static",
                    standalone / ".next/static",
                    dirs_exist_ok=True,
                )
                if (ROOT / "frontend/public").exists():
                    shutil.copytree(
                        ROOT / "frontend/public",
                        standalone / "public",
                        dirs_exist_ok=True,
                    )
                env["PORT"] = "13000"
                env["HOSTNAME"] = "127.0.0.1"
                start("frontend", ["node", str(standalone / "server.js")])
                wait_url("http://127.0.0.1:13000/login")
                subprocess.run(
                    [
                        os.environ.get("STUDY_WORKBENCH_BROWSER_PYTHON", "python"),
                        str(ROOT / "scripts/v1/browser_check.py"),
                        "--base",
                        "http://127.0.0.1:13000",
                        "--notebook",
                        nb,
                        "--out",
                        str(run / "screenshots"),
                        "--navigation-cases",
                        str(run / "navigation-cases.json"),
                    ],
                    cwd=ROOT,
                    env=env,
                    check=True,
                )
                results.append(
                    "Real Playwright login, source reader, search, note, refresh persistence, export and responsive tabs passed"
                )
            (run / "context.json").write_text(
                json.dumps(
                    {"notebook_id": nb, "upload": upload, "results": results},
                    ensure_ascii=False,
                    indent=2,
                )
            )
        print(
            json.dumps(
                {"status": "passed", "run_dir": str(run), "results": results},
                ensure_ascii=False,
                indent=2,
            )
        )
    finally:
        for p in reversed(procs):
            if p.poll() is None:
                p.terminate()
                try:
                    p.wait(10)
                except subprocess.TimeoutExpired:
                    p.kill()
        for h in handles:
            h.close()


if __name__ == "__main__":
    main()

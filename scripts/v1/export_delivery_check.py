"""Native Firefox export delivery check on isolated public fixtures.

Requires a completed production build and exclusive API port 5055. Never reads
private configuration or invokes Google/models. Faults are browser interceptions.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import socket
import subprocess
import tempfile
import time
import zipfile
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx
from local_check import ROOT, build_fixture_environment
from playwright.sync_api import expect, sync_playwright
from portable_limits_check import PASSWORD, free_port


def browser_check(base, client, notebook, env, out, start_worker):
    original = "# 公开备份验证\n\n原始材料应能随项目备份保存。\n".encode()
    note = "公开测试笔记：备份生成不等于文件已经保存。"
    response = client.post(
        f"/api/personal/notebooks/{notebook}/sources/upload",
        data={"idempotency_key": "public-export-original"},
        files={"file": ("公开备份.md", original, "text/markdown")},
    )
    response.raise_for_status()
    version = response.json()["source_version_id"]
    response = client.post(
        f"/api/personal/notebooks/{notebook}/notes",
        json={
            "title": "公开备份笔记",
            "content": note,
            "citations": [],
            "scope_snapshot": {"source_version_ids": [version]},
        },
    )
    response.raise_for_status()
    report: dict[str, Any] = {
        "scope": "Disposable native DB/API/worker + production Next; authored public fixture; browser-intercepted network faults, not real outages or user research; no Google or model calls.",
        "browser": "Firefox",
        "locale": "zh-CN",
        "viewport": {"width": 390, "height": 844},
        "cases": [],
        "page_errors": [],
        "status": "running",
    }
    with sync_playwright() as pw:
        browser = pw.firefox.launch(headless=True, env=env, timeout=90000)
        context = browser.new_context(
            viewport=report["viewport"], locale="zh-CN", accept_downloads=True
        )
        context.add_init_script("localStorage.setItem('i18nextLng', 'zh-CN')")
        blocked, exports, downloads, statuses = [], [], [], []

        def local_only(route):
            if not route.request.url.startswith(base + "/") or (
                route.request.method == "POST"
                and any(part in route.request.url for part in ("/ask", "/turns"))
            ):
                blocked.append("out-of-scope request blocked")
                route.abort()
            else:
                route.continue_()

        context.route("**/*", local_only)
        page = context.new_page()
        page.on("pageerror", lambda error: report["page_errors"].append(str(error)))
        page.on(
            "request",
            lambda request: exports.append(request.method)
            if request.method == "POST" and request.url.endswith("/exports")
            else None,
        )
        fault = {"status": False}

        def job_status(route):
            statuses.append("fault" if fault["status"] else "native")
            if fault["status"]:
                route.fulfill(
                    status=503,
                    content_type="application/json",
                    body='{"detail":"Controlled public fixture status fault"}',
                )
            else:
                route.continue_()

        page.route("**/personal/jobs/*", job_status)

        def screenshot(name):
            metrics = page.evaluate(
                "({width: innerWidth, documentWidth: document.documentElement.scrollWidth, height: innerHeight, documentHeight: document.documentElement.scrollHeight})"
            )
            assert metrics["documentWidth"] <= 391, metrics
            assert metrics["documentHeight"] <= 845, metrics
            page.screenshot(path=str(out / name), full_page=True)
            return metrics

        try:
            page.goto(base + "/notebooks/" + quote(notebook, safe="") + "/study")
            page.locator("input[type=password]").fill(PASSWORD)
            page.locator("button[type=submit]").click()
            page.wait_for_url(lambda url: "/login" not in url)
            summary = page.locator("summary").filter(has_text="项目备份")
            expect(summary).to_be_visible(timeout=30000)
            summary.focus()
            summary.press("Enter")
            disclosure = summary.locator("..")
            export = disclosure.get_by_role("button", name="导出项目", exact=True)
            export.focus()
            export.press("Enter")
            expect(
                disclosure.get_by_text("正在准备项目备份，尚未下载文件。", exact=True)
            ).to_be_visible(timeout=30000)
            expect(export).to_be_disabled()
            queued = client.get(f"/api/personal/notebooks/{notebook}/workspace").json()
            export_jobs = [
                j for j in queued["jobs"] if j["operation"] == "portable_export"
            ]
            assert len(export_jobs) == 1 and export_jobs[0]["state"] == "queued", (
                export_jobs
            )
            screenshot("01-queued-mobile.png")
            report["cases"].append(
                {
                    "case": "keyboard_export_from_backup_disclosure",
                    "native_state": "queued",
                    "export_posts": len(exports),
                    "export_jobs": len(export_jobs),
                }
            )
            fault["status"] = True
            error = disclosure.get_by_text(
                "暂时无法确认备份状态，请刷新状态，不要重复导出。", exact=True
            )
            expect(error).to_be_visible(timeout=15000)
            expect(export).to_be_disabled()
            screenshot("02-status-error-mobile.png")
            page.wait_for_timeout(2500)
            assert len(exports) == 1, "Status fault triggered a duplicate export"
            fault["status"] = False
            refresh = disclosure.get_by_role("button", name="刷新备份状态", exact=True)
            refresh.focus()
            refresh.press("Enter")
            expect(error).not_to_be_visible()
            assert len(exports) == 1
            start_worker()
            download = disclosure.get_by_role("button", name="下载项目包", exact=True)
            expect(download).to_be_visible(timeout=120000)
            expect(
                disclosure.get_by_text(
                    "项目包已生成，点击下方下载以保留副本。", exact=True
                )
            ).to_be_visible()
            expect(page.locator("#workbench-tab-conversation")).to_have_attribute(
                "aria-selected", "true"
            )
            screenshot("03-ready-mobile.png")
            report["cases"].append(
                {
                    "case": "manual_status_refresh_then_native_worker_completion",
                    "status_polling_scope": "Backup query pause covered by component tests; mounted task history may independently poll the same endpoint",
                    "same_disclosure_download": True,
                    "notes_tab_never_selected": True,
                    "export_posts": len(exports),
                }
            )

            def fail_download_once(route):
                downloads.append(route.request.url)
                if len(downloads) == 1:
                    route.fulfill(
                        status=503,
                        content_type="application/json",
                        body='{"detail":"Controlled public fixture download fault"}',
                    )
                else:
                    route.continue_()

            page.route("**/personal/exports/*/download", fail_download_once)
            download.focus()
            download.press("Enter")
            expect(
                disclosure.get_by_text(
                    "下载未完成，请再次点击“下载项目包”，无需重新导出。", exact=True
                )
            ).to_be_visible(timeout=15000)
            screenshot("04-download-error-mobile.png")
            assert len(downloads) == 1 and len(exports) == 1
            download.focus()
            with page.expect_download(timeout=30000) as saved:
                download.press("Enter")
            archive = Path(env["HOME"]) / "public-fixture-backup.zip"
            saved.value.save_as(archive)
            with zipfile.ZipFile(archive) as package:
                manifest = json.loads(package.read("manifest.json"))
                assert manifest["format_version"] == 1
                assert any(
                    item["content"] == note
                    for item in json.loads(package.read("notes.json"))
                )
                assert any(
                    package.read(name) == original
                    for name in package.namelist()
                    if name.startswith("originals/")
                )
                for name, metadata in manifest["files"].items():
                    content = package.read(name)
                    assert hashlib.sha256(content).hexdigest() == metadata["sha256"]
                    assert len(content) == metadata["byte_size"]
            assert len(downloads) == 2 and downloads[0] == downloads[1]
            final = client.get(f"/api/personal/notebooks/{notebook}/workspace").json()
            jobs = [j for j in final["jobs"] if j["operation"] == "portable_export"]
            assert len(jobs) == 1 and jobs[0]["state"] == "succeeded"
            assert len(exports) == 1
            expect(
                disclosure.get_by_text(
                    "已交给浏览器下载，请在浏览器下载记录中确认文件已保存。", exact=True
                )
            ).to_be_visible()
            screenshot("05-download-started-mobile.png")
            report["cases"].append(
                {
                    "case": "keyboard_download_fault_and_retry",
                    "same_artifact": True,
                    "download_requests": 2,
                    "export_posts": 1,
                    "backend_export_jobs": 1,
                    "zip_format_version": 1,
                    "original_bytes_verified": True,
                    "saved_note_verified": True,
                    "manifest_hashes_verified": True,
                    "archive_bytes": archive.stat().st_size,
                    "archive_sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
                    "saved_claim": "Playwright received and saved ZIP in this disposable test; UI starts a download, not proof of user-device persistence.",
                }
            )
            assert not blocked and not report["page_errors"]
            report["status"] = "passed"
        except Exception:
            page.screenshot(path=str(out / "failure.png"), full_page=True)
            report["status"] = "failed"
            raise
        finally:
            report["export_posts"] = len(exports)
            report["status_requests"] = statuses
            report["blocked_requests"] = blocked
            (out / "results.json").write_text(
                json.dumps(report, ensure_ascii=False, indent=2) + "\n"
            )
            browser.close()
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 5055))
    run = Path(tempfile.mkdtemp(prefix="export-delivery-", dir=ROOT / ".runtime"))
    db_port, ui_port = free_port(), free_port()
    base = f"http://127.0.0.1:{ui_port}"
    env = build_fixture_environment(
        run,
        {
            key: os.environ[key]
            for key in ("PATH", "LANG", "LC_ALL")
            if key in os.environ
        },
    )
    env.update(
        SURREAL_URL=f"ws://127.0.0.1:{db_port}/rpc",
        API_URL=base,
        CORS_ORIGINS=base,
        PORT=str(ui_port),
        HOSTNAME="127.0.0.1",
        HOME=str(run),
        XDG_CONFIG_HOME=str(run / "config"),
        XDG_CACHE_HOME=str(run / "cache"),
    )
    standalone = ROOT / "frontend/.next/standalone"
    shutil.copytree(
        ROOT / "frontend/.next/static", standalone / ".next/static", dirs_exist_ok=True
    )
    shutil.copytree(ROOT / "frontend/public", standalone / "public", dirs_exist_ok=True)
    procs, handles = [], []

    def start(name, command):
        handle = (run / f"{name}.log").open("w")
        handles.append(handle)
        procs.append(
            subprocess.Popen(
                command, cwd=ROOT, env=env, stdout=handle, stderr=subprocess.STDOUT
            )
        )

    def wait_url(url):
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            assert all(proc.poll() is None for proc in procs), (
                f"Fixture process exited: {run}"
            )
            try:
                if httpx.get(url, timeout=1, trust_env=False).status_code == 200:
                    return
            except httpx.HTTPError:
                pass
            time.sleep(0.25)
        raise AssertionError("Fixture startup timed out")

    try:
        start(
            "db",
            [
                str(ROOT / ".runtime/bin/surreal"),
                "start",
                "--bind",
                f"127.0.0.1:{db_port}",
                "--user",
                "root",
                "--pass",
                PASSWORD,
                "--log",
                "warn",
                "rocksdb:" + str(run / "db"),
            ],
        )
        wait_url(f"http://127.0.0.1:{db_port}/health")
        start(
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

        def start_worker():
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

        start("frontend", ["node", str(standalone / "server.js")])
        wait_url(base + "/login")
        with httpx.Client(
            base_url="http://127.0.0.1:5055",
            headers={"Authorization": "Bearer " + PASSWORD},
            timeout=30,
            trust_env=False,
        ) as client:
            response = client.post(
                "/api/notebooks",
                json={
                    "name": "公开备份下载验证",
                    "description": "Disposable authored public fixture; controlled network faults, not real-user research",
                },
            )
            response.raise_for_status()
            report = browser_check(
                base, client, response.json()["id"], env, args.out, start_worker
            )
            print(json.dumps(report, ensure_ascii=False, indent=2))
    finally:
        for proc in reversed(procs):
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(10)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(10)
        for handle in handles:
            handle.close()


if __name__ == "__main__":
    main()

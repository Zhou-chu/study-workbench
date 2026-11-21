"""Firefox recovery regression on disposable native stack; public fixtures only.

Network faults are controlled browser interceptions, not real outages or user research.
Requires a completed production build and exclusive availability of API port 5055.
Never loads private configuration, configures a provider, or submits model questions.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import socket
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote

import httpx
from local_check import ROOT, build_fixture_environment
from playwright.sync_api import expect, sync_playwright
from portable_limits_check import PASSWORD, free_port


def browser_check(base, client, notebook, env, out):
    report: dict[str, Any] = {
        "scope": "Disposable native DB/API/worker and production Next build; public fixture; controlled network faults, not real-user research. No private configuration, Google operations or model calls.",
        "browser": "Firefox",
        "locale": "zh-CN",
        "cases": [],
        "page_errors": [],
    }
    target = base + "/notebooks/" + quote(notebook, safe="") + "/study"
    with sync_playwright() as pw:
        browser = pw.firefox.launch(headless=True, env=env, timeout=90000)
        context = browser.new_context(
            viewport={"width": 1440, "height": 1000}, locale="zh-CN"
        )
        context.add_init_script("localStorage.setItem('i18nextLng', 'zh-CN')")
        blocked = []

        def local_only(route):
            if not route.request.url.startswith(base + "/"):
                blocked.append("external request blocked")
                route.abort()
            elif route.request.method == "POST" and (
                "/ask" in route.request.url or "/turns" in route.request.url
            ):
                blocked.append("question submission blocked")
                route.abort()
            else:
                route.continue_()

        context.route("**/*", local_only)
        page = context.new_page()
        upload_request_count = []
        page.on(
            "request",
            lambda request: upload_request_count.append(True)
            if request.method == "POST" and request.url.endswith("/sources/upload")
            else None,
        )
        page.on("pageerror", lambda error: report["page_errors"].append(str(error)))
        try:
            page.goto(target)
            page.locator("input[type=password]").fill(PASSWORD)
            page.locator("button[type=submit]").click()
            page.wait_for_url(lambda url: "/login" not in url)
            page.goto(base + "/notebooks")
            entry = page.get_by_role("link", name="打开学习工作台", exact=True).first
            expect(entry).to_be_visible(timeout=30000)
            entry.click()
            page.wait_for_url(
                lambda url: unquote(str(url)).endswith(
                    "/notebooks/" + notebook + "/study"
                )
            )
            report["cases"].append(
                {
                    "case": "notebook_list_direct_study_entry",
                    "clicked_visible_link": True,
                }
            )
            expect(page.locator("#note-content")).to_be_visible(timeout=30000)
            page.screenshot(path=str(out / "00-empty-desktop.png"), full_page=True)
            page.set_viewport_size({"width": 390, "height": 844})
            expect(page.get_by_text("从学习资料开始", exact=True)).to_be_visible()
            page.screenshot(path=str(out / "00-empty-mobile.png"), full_page=True)
            expect(
                page.get_by_text(
                    "无需连接 Google 或配置模型，也能上传、阅读、搜索已选资料和写笔记。",
                    exact=True,
                )
            ).to_be_visible()
            first_cta = page.get_by_role("button", name="添加学习资料", exact=True)
            expect(first_cta).to_be_visible()
            first_cta.focus()
            first_cta.press("Enter")
            expect(page.locator("#workbench-tab-sources")).to_have_attribute(
                "aria-selected", "true"
            )
            expect(page.locator("input[type=file][multiple]")).to_be_focused()
            assert page.evaluate("document.documentElement.scrollWidth") <= 391
            page.screenshot(
                path=str(out / "00-first-upload-mobile.png"), full_page=True
            )
            google = page.locator("summary").filter(
                has_text="Google NotebookLM（可选）"
            )
            disclosure = google.locator("..")
            expect(disclosure).not_to_have_attribute("open", "")
            google.focus()
            google.press("Enter")
            expect(disclosure).to_have_attribute("open", "")
            google.press("Enter")
            expect(disclosure).not_to_have_attribute("open", "")
            assert not upload_request_count
            assert page.locator("input[type=checkbox]:checked").count() == 0
            page.set_viewport_size({"width": 1440, "height": 1000})
            report["cases"].append(
                {
                    "case": "empty_mobile_first_use_cta",
                    "sources_tab_selected": True,
                    "upload_input_focused": True,
                    "google_disclosure_keyboard": True,
                    "scope_unchanged_zero": True,
                    "no_upload_request": True,
                }
            )
            page.locator("#note-content").fill(
                "公开测试：这段尚未保存的笔记不能在恢复时丢失。"
            )
            draft = page.locator("#note-content").input_value()
            uploads = []
            keys = []
            file_payloads = []

            def uncertain_upload(route):
                body = route.request.post_data_buffer.decode("utf-8")
                key = re.search(r'name="idempotency_key"\r\n\r\n([^\r]+)', body)
                assert key, "No multipart idempotency key"
                keys.append(key.group(1))
                file_header = re.search(r'name="file"; filename="[^\"]+"\r\n', body)
                assert file_header, "No multipart file payload"
                # Locate each delimiter once. Repeated lazy wildcards rescanned
                # every possible header ending when the payload terminator was absent.
                header_end = body.find("\r\n\r\n", file_header.end())
                assert header_end >= 0, "No multipart file payload"
                payload_start = header_end + 4
                payload_end = body.find("\r\n--", payload_start)
                assert payload_end >= 0, "No multipart file payload"
                file_payloads.append(body[payload_start:payload_end])
                response = route.fetch()
                assert response.ok, response.status
                uploads.append(response.json())
                if len(uploads) == 1:
                    route.abort("failed")
                else:
                    route.fulfill(response=response)

            page.route("**/sources/upload", uncertain_upload)
            page.locator("input[type=file][multiple]").set_input_files(
                {
                    "name": "公开恢复测试.md",
                    "mimeType": "text/markdown",
                    "buffer": "# 公开恢复测试\n\n证据应来自可核验的原始材料。\n".encode(),
                }
            )
            retry = page.get_by_role("button", name="重试这次上传", exact=True)
            expect(retry).to_be_visible(timeout=30000)
            assert len(uploads) == 1
            before = client.get(f"/api/personal/notebooks/{notebook}/workspace").json()
            assert len(before["sources"]) == 1
            page.screenshot(
                path=str(out / "01-upload-uncertain-desktop.png"), full_page=True
            )
            page.set_viewport_size({"width": 390, "height": 844})
            page.locator("#workbench-tab-sources").click()
            expect(retry).to_be_visible()
            assert page.evaluate("document.documentElement.scrollWidth") <= 391
            page.screenshot(
                path=str(out / "01-upload-uncertain-mobile.png"), full_page=True
            )
            page.set_viewport_size({"width": 1440, "height": 1000})
            retry.focus()
            expect(retry).to_be_focused()
            with page.expect_response(
                lambda response: response.url.endswith("/sources/upload")
                and response.request.method == "POST",
                timeout=30000,
            ) as retried_response:
                retry.press("Enter")
            assert retried_response.value.ok
            expect(retry).to_have_count(0, timeout=30000)
            assert len(uploads) == 2 and keys[0] == keys[1]
            assert uploads[0] == uploads[1]
            assert file_payloads[0] == file_payloads[1]
            after = client.get(f"/api/personal/notebooks/{notebook}/workspace").json()
            assert (
                len(after["sources"]) == 1 and len(after["sources"][0]["versions"]) == 1
            )
            expect(page.locator("#note-content")).to_have_value(draft)
            report["cases"].append(
                {
                    "case": "committed_upload_lost_response_manual_keyboard_retry",
                    "backend_committed_before_abort": True,
                    "same_key_file_bytes_and_response": True,
                    "sources": 1,
                    "versions": 1,
                    "unsaved_note_retained": True,
                }
            )
            version = uploads[0]["source_version_id"]
            deadline = time.monotonic() + 90
            while True:
                detail = client.get(f"/api/personal/source-versions/{version}").json()
                if detail.get("extraction", {}).get("status") == "ready":
                    break
                assert time.monotonic() < deadline, "CPU extraction timeout"
                time.sleep(0.25)
            question_draft = "这份公开资料的主要观点是什么？"
            page.get_by_role("button", name="对话", exact=True).click()
            page.locator("#workbench-question").fill(question_draft)
            reader_requests = []

            def fail_reader_once(route):
                reader_requests.append(route.request.method)
                if len(reader_requests) == 1:
                    route.fulfill(
                        status=503,
                        content_type="application/json",
                        body='{"detail":"Controlled public fixture network fault"}',
                    )
                else:
                    route.continue_()

            page.route(
                "**/source-versions/" + quote(version, safe=""), fail_reader_once
            )
            page.get_by_role("button", name="阅读", exact=True).first.click()
            expect(
                page.get_by_text(
                    "暂时无法打开这份资料。可以在这里重试，无需离开笔记。", exact=True
                )
            ).to_be_visible()
            page.screenshot(
                path=str(out / "02-reader-retry-desktop.png"), full_page=True
            )
            retry_reader = page.get_by_role("button", name="重试", exact=True)
            page.set_viewport_size({"width": 390, "height": 844})
            page.locator("#workbench-tab-conversation").click()
            expect(retry_reader).to_be_visible()
            assert page.evaluate("document.documentElement.scrollWidth") <= 391
            page.screenshot(
                path=str(out / "02-reader-retry-mobile.png"), full_page=True
            )
            page.set_viewport_size({"width": 1440, "height": 1000})
            retry_reader.focus()
            retry_reader.press("Enter")
            expect(
                page.get_by_role("button", name="下载此版本原件", exact=True)
            ).to_be_visible(timeout=15000)
            expect(page.locator("#note-content")).to_have_value(draft)
            assert len(reader_requests) == 2
            expect(page.locator("#workbench-question")).to_have_value(question_draft)
            page.screenshot(
                path=str(out / "02-reader-recovered-desktop.png"), full_page=True
            )
            page.set_viewport_size({"width": 390, "height": 844})
            page.locator("#workbench-tab-conversation").click()
            page.screenshot(
                path=str(out / "02-reader-recovered-mobile.png"), full_page=True
            )
            page.set_viewport_size({"width": 1440, "height": 1000})
            report["cases"].append(
                {
                    "case": "reader_503_explicit_keyboard_retry",
                    "unsent_question_retained": True,
                    "requests": 2,
                    "no_reload": True,
                    "unsaved_note_retained": True,
                }
            )
            # Selected local source makes model readiness the decisive gate.
            page.locator("#workbench-engine").select_option("independent")
            page.locator("input[type=checkbox]").first.check()
            page.get_by_role("button", name="对话", exact=True).click()
            page.locator("#workbench-question").fill("这份公开资料的主要观点是什么？")
            ask = page.locator(
                'button[aria-describedby="workbench-model-status"]'
            ).first
            outline = page.locator(
                'button[aria-describedby="workbench-model-status"]'
            ).nth(1)
            expect(ask).to_be_disabled()
            expect(outline).to_be_disabled()
            expect(page.locator("#workbench-model-status")).to_contain_text("设置")
            page.screenshot(
                path=str(out / "03-model-unconfigured-desktop.png"), full_page=True
            )
            report["cases"].append(
                {
                    "case": "real_model_defaults_unconfigured",
                    "ask_disabled": True,
                    "outline_disabled": True,
                }
            )
            # New page/context cache ensures a failed initial defaults request.
            page.route(
                "**/models/defaults",
                lambda route: route.fulfill(
                    status=503,
                    content_type="application/json",
                    body='{"detail":"Controlled defaults fault"}',
                ),
            )
            page.reload()
            page.get_by_role("button", name="对话", exact=True).click()
            check = page.get_by_role("button", name="重新检查模型设置", exact=True)
            expect(check).to_be_visible(timeout=15000)
            expect(ask).to_be_disabled()
            expect(outline).to_be_disabled()
            page.locator("#note-content").fill(draft)
            page.screenshot(
                path=str(out / "04-model-error-desktop.png"), full_page=True
            )
            page.unroute("**/models/defaults")
            held = []
            page.route("**/models/defaults", lambda route: held.append(route))
            check.click()
            expect(page.locator("#workbench-model-status")).to_contain_text(
                "正在查看模型设置"
            )
            expect(ask).to_be_disabled()
            expect(outline).to_be_disabled()
            page.screenshot(
                path=str(out / "05-model-checking-desktop.png"), full_page=True
            )
            assert len(held) == 1
            held[0].continue_()
            expect(check).to_have_count(0)
            expect(page.locator("#workbench-model-status")).to_contain_text("设置")
            expect(page.locator("#note-content")).to_have_value(draft)
            report["cases"].append(
                {
                    "case": "model_defaults_error_loading_explicit_retry",
                    "ask_disabled": True,
                    "outline_disabled": True,
                    "returned_real_unconfigured": True,
                    "unsaved_note_retained": True,
                }
            )
            page.set_viewport_size({"width": 390, "height": 844})
            mobile = []
            for label, tab in [
                ("资料", "sources"),
                ("阅读与提问", "conversation"),
                ("笔记与成果", "notes"),
            ]:
                page.locator("#workbench-tab-" + tab).click()
                metrics = page.evaluate(
                    """() => ({width: innerWidth, documentWidth: document.documentElement.scrollWidth, height: innerHeight, documentHeight: document.documentElement.scrollHeight})"""
                )
                assert metrics["documentWidth"] <= 391, metrics
                assert metrics["documentHeight"] <= 845, metrics
                mobile.append({"panel": label, **metrics})
                page.screenshot(
                    path=str(out / f"mobile-{len(mobile)}.png"), full_page=True
                )
            task_label = page.get_by_text("提取资料文字", exact=True)
            expect(task_label).to_be_visible()
            task_label.scroll_into_view_if_needed()
            raw_operation = page.get_by_text("extract_evidence", exact=True)
            expect(raw_operation).not_to_be_visible()
            expect(
                page.get_by_text("提交状态：not_submitted", exact=True)
            ).not_to_be_visible()
            page.screenshot(
                path=str(out / "06-friendly-task-mobile.png"), full_page=True
            )
            technical = page.locator("summary").filter(has_text="技术详情").first
            technical.focus()
            technical.press("Enter")
            expect(raw_operation).to_be_visible()
            technical.press("Enter")
            expect(raw_operation).not_to_be_visible()
            report["cases"].append(
                {
                    "case": "friendly_task_label_collapsed_keyboard_diagnostics",
                    "friendly_label": "提取资料文字",
                    "raw_operation_hidden_by_default": True,
                }
            )
            report["mobile"] = mobile
            assert not report["page_errors"], report["page_errors"]
            assert not blocked, blocked
            report["blocked_requests"] = blocked
            report["status"] = "passed"
        except Exception:
            page.screenshot(path=str(out / "failure.png"), full_page=True)
            report["status"] = "failed"
            raise
        finally:
            (out / "results.json").write_text(
                json.dumps(report, ensure_ascii=False, indent=2)
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
    run = Path(tempfile.mkdtemp(prefix="ux-recovery-", dir=ROOT / ".runtime"))
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
                    "name": "公开恢复体验验证",
                    "description": "Disposable authored public fixture; controlled network faults, not real-user research",
                },
            )
            response.raise_for_status()
            report = browser_check(base, client, response.json()["id"], env, args.out)
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

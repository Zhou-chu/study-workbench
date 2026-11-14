"""Isolated settings interaction QA: synthetic API only; never uses a user profile."""

import json
import os
import pwd
import signal
import subprocess
import time
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[3]
BASE = "http://127.0.0.1:18864"
OUT = ROOT / ".superpowers/sdd/notebook-spa-redesign/settings-controls-review"
OUT.mkdir(parents=True, exist_ok=True)
TOOLS = (Path(pwd.getpwuid(os.getuid()).pw_dir) / "study-workbench-deploy-20261107")
FONTS = (Path(pwd.getpwuid(os.getuid()).pw_dir) / "study-workbench-worktrees-20261108/notebook-editorial-20261110/.superpowers/sdd/notebook-spa-redesign/fonts")
# Reuse only fixture declarations/handler, never the older script's browser runner.
fixture = {"__file__": str(ROOT / "apps/web/scripts/visual-review.py")}
exec(
    (ROOT / "apps/web/scripts/visual-review.py")
    .read_text()
    .split("with sync_playwright() as p:")[0],
    fixture,
)
fallback = fixture["api"]
env = dict(
    os.environ, PATH=str(TOOLS / "tools/node-v24.19.0-linux-x64/bin") + ":/usr/bin:/bin"
)
env["SPA_ARTIFACT_IDENTITY"] = json.dumps(
    {
        "release_slot": "synthetic-settings-preview",
        "source_commit": "a" * 40,
        "authored_digest": "b" * 64,
        "contract_digest": "d" * 64,
        "ui_transport_protocol": 1,
        "supported_contracts": ["workspace-view-v1"],
    }
)
env["PLAYWRIGHT_BROWSERS_PATH"] = str(TOOLS / "cache/browsers")
os.environ["PLAYWRIGHT_BROWSERS_PATH"] = env["PLAYWRIGHT_BROWSERS_PATH"]
server = subprocess.Popen(
    [
        "../../node_modules/.bin/vite",
        "--host",
        "127.0.0.1",
        "--port",
        "18864",
        "--strictPort",
        "--base",
        "/",
    ],
    cwd=ROOT / "apps/web",
    env=env,
    start_new_session=True,
    stdout=(OUT / "vite.log").open("w"),
    stderr=subprocess.STDOUT,
)
results = []
writes = []
blocked = []
errors = []
try:
    time.sleep(2)
    if server.poll() is not None:
        raise RuntimeError("Private preview failed to start; see vite.log")
    with sync_playwright() as p:
        browser = p.firefox.launch(headless=True)
        for width, height in [(1440, 1000), (390, 844)]:
            for theme in ["light", "dark"]:
                mode = {"failure": None}
                stored = []
                context = browser.new_context(
                    viewport={"width": width, "height": height},
                    locale="en-US",
                    color_scheme=theme,
                )

                def api(route):
                    path = urlparse(route.request.url).path
                    if path == "/api/" + str(mode["failure"]):
                        route.fulfill(
                            status=503,
                            content_type="application/json",
                            body='{"detail":"Synthetic metadata failure"}',
                        )
                        return
                    if path == "/api/providers":
                        route.fulfill(
                            json=[
                                {
                                    "name": "openai",
                                    "display_name": "OpenAI",
                                    "modalities": ["language", "embedding"],
                                    "docs_url": None,
                                    "env_configured": False,
                                },
                                {
                                    "name": "vertex",
                                    "display_name": "Vertex",
                                    "modalities": ["language"],
                                    "docs_url": None,
                                    "env_configured": False,
                                },
                            ]
                        )
                        return
                    if path == "/api/credentials":
                        if route.request.method == "POST":
                            body = route.request.post_data_json
                            writes.append(
                                {
                                    "provider": body["provider"],
                                    "method": "POST",
                                    "synthetic": True,
                                }
                            )
                            stored.append(
                                {
                                    "id": "credential:synthetic",
                                    "name": body["name"],
                                    "provider": body["provider"],
                                    "modalities": body["modalities"],
                                    "base_url": None,
                                    "endpoint": None,
                                    "endpoint_llm": None,
                                    "endpoint_embedding": None,
                                    "endpoint_stt": None,
                                    "endpoint_tts": None,
                                    "credentials_path": None,
                                    "project": None,
                                    "location": None,
                                    "api_version": None,
                                    "num_ctx": None,
                                    "has_api_key": True,
                                    "model_count": 0,
                                    "decryption_error": None,
                                    "created": "2026-11-10",
                                    "updated": "2026-11-10",
                                }
                            )
                            route.fulfill(json=stored[-1])
                            return
                        route.fulfill(json=stored)
                        return
                    fallback(route)

                context.route("**/spa-artifact-manifest.json", api)
                context.route("**/config", api)
                context.route("**/api/**", api)

                def network(route):
                    u = urlparse(route.request.url)
                    if (
                        u.scheme not in ["http", "https"]
                        or u.netloc != "127.0.0.1:18864"
                    ):
                        blocked.append(route.request.url)
                        route.abort()
                    else:
                        route.fallback()

                context.route("**/*", network)
                context.route(
                    "**/qa-font.ttf",
                    lambda r: r.fulfill(
                        path=str(FONTS / "arial.ttf"), content_type="font/ttf"
                    ),
                )
                page = context.new_page()
                page.on("pageerror", lambda e: errors.append(str(e)))
                page.set_default_timeout(15000)

                def capture(name):
                    page.add_style_tag(
                        content="@font-face{font-family:QA;src:url('/qa-font.ttf')}*{font-family:QA,sans-serif!important}"
                    )
                    page.evaluate("document.fonts.ready")
                    path = OUT / f"{width}-{theme}-{name}.png"
                    page.screenshot(path=str(path), full_page=True)
                    overflow = page.evaluate(
                        "document.documentElement.scrollWidth > innerWidth"
                    )
                    results.append(
                        {
                            "view": name,
                            "width": width,
                            "theme": theme,
                            "overflow": overflow,
                            "screenshot": str(path),
                        }
                    )
                    assert not overflow, name

                def visit():
                    page.goto(BASE + "/settings/models", wait_until="domcontentloaded")
                    page.wait_for_timeout(
                        2000
                    )  # Allow private Vite first-run dependency optimization reload.

                visit()
                add = page.get_by_role(
                    "button", name="Add Configuration: Vertex", exact=True
                )
                expect(add).to_be_enabled()
                capture("settings")
                add.click()
                d = page.get_by_role("dialog")
                d.get_by_label("Name", exact=True).fill("Synthetic Vertex")
                key = d.get_by_label("API Key", exact=True)
                key.fill("synthetic-unsent-browser-key")
                d.get_by_role("button", name="Save configuration", exact=True).click()
                expect(d.get_by_role("alert")).to_contain_text("Project")
                expect(d.get_by_role("alert")).to_be_focused()
                expect(d.get_by_role("alert")).to_be_in_viewport()
                expect(key).to_have_value("synthetic-unsent-browser-key")
                capture("validation")
                d.get_by_role("button", name="Cancel", exact=True).click()
                page.get_by_role(
                    "button", name="Add Configuration: OpenAI", exact=True
                ).click()
                d = page.get_by_role("dialog")
                d.get_by_label("Name", exact=True).fill(
                    "Synthetic browser configuration"
                )
                d.get_by_label("API Key", exact=True).fill("synthetic-browser-key")
                d.get_by_role("button", name="Save configuration", exact=True).click()
                expect(d).not_to_be_visible()
                expect(
                    page.get_by_role(
                        "heading", name="Synthetic browser configuration", exact=True
                    )
                ).to_be_visible()
                capture("saved")
                for fail in ["models", "models/defaults"]:
                    mode["failure"] = fail
                    page.get_by_role("button", name="Refresh", exact=True).click()
                    expect(
                        page.get_by_text(
                            "Could not load: "
                            + (
                                "registered models"
                                if fail == "models"
                                else "default model assignments"
                            ),
                            exact=True,
                        )
                    ).to_be_visible()
                    page.get_by_role(
                        "button", name="Add Configuration: OpenAI", exact=True
                    ).click()
                    expect(
                        page.get_by_role("dialog").get_by_label("Name", exact=True)
                    ).to_be_enabled()
                    page.get_by_role("dialog").get_by_role(
                        "button", name="Cancel", exact=True
                    ).click()
                    capture(fail.replace("/", "-") + "-failure")
                mode["failure"] = "credentials"
                page.get_by_role("button", name="Refresh", exact=True).click()
                expect(
                    page.get_by_text("Could not load: saved configurations", exact=True)
                ).to_be_visible()
                expect(
                    page.get_by_role(
                        "button", name="Add Configuration: OpenAI", exact=True
                    )
                ).to_be_disabled()
                capture("prerequisite-failure")
                mode["failure"] = None
                page.get_by_role(
                    "button", name="Retry loading settings", exact=True
                ).click()
                expect(
                    page.get_by_role(
                        "button", name="Add Configuration: OpenAI", exact=True
                    )
                ).to_be_enabled()
                context.close()
        browser.close()
    assert len(writes) == 4 and not errors
finally:
    os.killpg(server.pid, signal.SIGTERM)
    server.wait(timeout=15)
    (OUT / "report.json").write_text(
        json.dumps(
            {
                "boundary": "Private Vite + isolated headless Firefox; every API response synthetic. No live service, real credentials, provider calls, or user profile.",
                "results": results,
                "synthetic_writes": writes,
                "blocked_external_requests": blocked,
                "page_errors": errors,
                "preview_pid": server.pid,
                "preview_stopped": server.poll() is not None,
            },
            indent=2,
        )
    )
    print(OUT, flush=True)

"""Real Playwright actions against isolated native stack; public fixtures only."""

import argparse
import json
import os
import re
import stat
from pathlib import Path
from types import SimpleNamespace
from typing import TYPE_CHECKING
from urllib.parse import quote, urlsplit

if TYPE_CHECKING or __package__:
    from .browser_context import BrowserContext, load_context
    from .browser_upload_fixture import run_typed_unsafe_fixture
else:
    from browser_context import BrowserContext, load_context
    from browser_upload_fixture import run_typed_unsafe_fixture


def browser_environment(profile: Path, inherited: dict[str, str]) -> dict[str, str]:
    return {
        **{
            key: value
            for key, value in inherited.items()
            if key in {"PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ"}
        },
        "HOME": str(profile),
        "TMPDIR": str(profile),
        "XDG_CONFIG_HOME": str(profile / "config"),
        "XDG_CACHE_HOME": str(profile / "cache"),
    }


def validate_firefox_executable(path: Path) -> str:
    if not path.is_absolute() or any(p.is_symlink() for p in (path, *path.parents)):
        raise ValueError("Firefox must be an absolute non-symlink executable")
    if not stat.S_ISREG(path.stat().st_mode) or not os.access(path, os.X_OK):
        raise ValueError("Firefox executable unavailable")
    return str(path)


def browser_launch_options(engine, profile, executable):
    options = {"headless": True, "env": browser_environment(profile, dict(os.environ))}
    if engine == "firefox" and executable is not None:
        options["executable_path"] = validate_firefox_executable(executable)
    elif engine == "chromium" and executable is None:
        options.update(executable_path="/usr/bin/chromium", chromium_sandbox=True)
    else:
        raise ValueError(
            "Firefox requires explicit executable; Chromium cannot override it"
        )
    return options


def route_owned_request(guard: BrowserContext, route):
    try:
        request_url = urlsplit(route.request.url)
        if (request_url.scheme, request_url.netloc) != (
            "http",
            f"127.0.0.1:{guard.data['ports']['frontend']}",
        ):
            raise RuntimeError("Browser request left the owned fixture origin")
        guard.assert_runtime()
    except Exception:
        route.abort()
        raise
    route.continue_()


def successful_response(response, method, url):
    return (
        response.request.method == method
        and response.url == url
        and 200 <= response.status < 300
    )


def validate_mobile_metrics(metrics, reader=False):
    assert metrics["viewport"] == 390, metrics
    assert metrics["document_width"] <= 391, metrics
    assert metrics["main_width"] >= 389, metrics
    assert metrics["panels"], metrics
    for panel in metrics["panels"]:
        assert panel["width"] >= 350, metrics
        assert panel["content_width"] <= panel["client_width"] + 1, metrics
    if reader:
        assert metrics["canvas"] and metrics["canvas"]["width"] >= 300, metrics
        assert 0 <= metrics["canvas"]["left"] < metrics["canvas"]["right"] <= 390, (
            metrics
        )


def validate_viewport_metrics(metrics):
    assert metrics["document_height"] <= metrics["viewport"] + 1, metrics
    assert metrics["body_height"] <= metrics["viewport"] + 1, metrics


def validate_pdf_pixels(pixels):
    assert pixels > 100, ("Blank PDF raster", pixels)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-context", required=True)
    parser.add_argument("--engine", choices=["chromium", "firefox"], default="chromium")
    parser.add_argument("--firefox-executable", type=Path)
    options = parser.parse_args()
    guard = load_context(Path(options.run_context))
    run_browser(guard, options.engine, options.firefox_executable)


def run_browser(guard: BrowserContext, engine: str, executable: Path | None = None):
    guard.recheck()
    from playwright.sync_api import expect, sync_playwright

    args = SimpleNamespace(
        base=guard.base,
        notebook=guard.notebook,
        out=guard.out,
        navigation_cases=guard.navigation_cases,
        engine=engine,
    )
    out = guard.out
    out.mkdir(parents=False, exist_ok=True)
    # Parent owns driver/browser HOME and TMPDIR until descendant drain completes.
    profile_home = guard.path.parent / "browser-temp" / "home"
    launch_options = browser_launch_options(engine, profile_home, executable)
    with sync_playwright() as pw:
        browser = getattr(pw, args.engine).launch(**launch_options)
        context = browser.new_context(
            viewport={"width": 1440, "height": 1000},
            locale="en-US",
            service_workers="block",
        )

        context.route("**/*", lambda route: route_owned_request(guard, route))
        page = context.new_page()
        errors = []
        raster_checks = []
        mobile_checks = []
        viewport_checks = []
        location_checks = []
        restored_location_checks = []
        maintenance_checks = []
        page.on("pageerror", lambda error: errors.append(str(error)))

        def assert_viewport_height(label):
            metrics = page.evaluate("""() => ({
                viewport: innerHeight,
                document_height: document.documentElement.scrollHeight,
                body_height: document.body.scrollHeight,
                header_height: document.querySelector('header').getBoundingClientRect().height
            })""")
            viewport_checks.append({"view": label, **metrics})
            (out / "viewport-checks.json").write_text(
                json.dumps(viewport_checks, indent=2)
            )
            validate_viewport_metrics(metrics)

        def assert_pdf_page(number):
            canvas = page.locator("canvas[data-page-number]")
            expect(canvas).to_have_attribute(
                "data-page-number", str(number), timeout=15000
            )
            expect(canvas).to_have_attribute(
                "data-render-state", "ready", timeout=30000
            )
            expect(canvas).to_be_visible()
            pixels = canvas.evaluate("""canvas => {
                const context = canvas.getContext('2d');
                const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
                let marked = 0;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i+3] > 0 && data[i] < 200 && data[i+1] < 200 && data[i+2] < 200) marked++;
                }
                return marked;
            }""")
            validate_pdf_pixels(pixels)
            raster_checks.append({"physical_page": number, "nonwhite_pixels": pixels})

        def assert_mobile_layout(label, reader=False):
            metrics = page.evaluate("""() => {
                const visible = element => element.getClientRects().length > 0;
                const main = document.querySelector('main');
                const panels = [...document.querySelectorAll('#workbench-panel-conversation, #workbench-panel-sources, #workbench-panel-notes')].filter(visible);
                const canvas = document.querySelector('canvas[data-page-number]');
                const bounds = canvas && visible(canvas) ? canvas.getBoundingClientRect() : null;
                return {
                    viewport: innerWidth,
                    document_width: document.documentElement.scrollWidth,
                    main_width: main.getBoundingClientRect().width,
                    panels: panels.map(panel => ({width: panel.getBoundingClientRect().width, content_width: panel.scrollWidth, client_width: panel.clientWidth})),
                    canvas: bounds ? {width: bounds.width, left: bounds.left, right: bounds.right} : null,
                };
            }""")
            validate_mobile_metrics(metrics, reader=reader)
            mobile_checks.append({"view": label, **metrics})

        def loaded_workspace(action, url):
            with page.expect_response(
                lambda r: successful_response(r, "GET", url), timeout=30000
            ) as response:
                action()
            payload = response.value.json()
            assert payload["sources"], "Fixture workspace has no sources"
            expect(page.locator("#workbench-panel-sources")).to_be_attached()
            expect(
                page.get_by_role(
                    "heading", level=1, name=payload["notebook"]["name"], exact=True
                )
            ).to_be_visible()
            return payload

        def reader_version():
            reader = page.get_by_role("region", name="Reader", exact=True)
            tools = reader.locator("details").filter(
                has=page.get_by_text("Document tools", exact=True)
            )
            if not tools.get_attribute("open") == "":
                tools.locator("summary").click()
            version = tools.locator(":scope > p").first
            expect(version).to_be_visible()
            return version

        def open_notebook_tools():
            tools = page.locator('summary[aria-label="Notebook tools"]')
            if tools.locator("..").get_attribute("open") is None:
                tools.click()

        target = args.base + "/notebooks/" + quote(args.notebook, safe="") + "/study"
        try:
            page.goto(target)
            page.locator("input[type=password]").wait_for(timeout=30000)
            assert "/login" in page.url, page.url
            page.screenshot(path=str(out / "01-private-login.png"), full_page=True)
            page.locator("input[type=password]").fill(guard.password)
            workspace_url = (
                args.base
                + "/api/personal/notebooks/"
                + quote(args.notebook, safe="")
                + "/workspace"
            )
            loaded = loaded_workspace(
                lambda: page.locator("button[type=submit]").click(), workspace_url
            )
            page.wait_for_url(target, timeout=30000)
            expect(
                page.get_by_text("fixture_course.md", exact=True).first
            ).to_be_visible()
            page.get_by_role("article").filter(
                has=page.get_by_role("heading", name="fixture_course.md", exact=True)
            ).get_by_role("button", name="Read", exact=True).click()
            expect(
                page.get_by_role("button", name="Download original version", exact=True)
            ).to_be_visible(timeout=15000)
            page.locator("#workspace-search").fill("证据")
            with page.expect_response(
                lambda r: successful_response(
                    r, "POST", args.base + "/api/personal/search"
                )
            ) as search_response:
                page.get_by_role("button", name="Search", exact=True).click()
            search_hits = search_response.value.json()["hits"]
            assert search_hits, "Public fixture lexical search returned no hits"
            expect(
                page.locator("#workbench-panel-sources").get_by_role(
                    "button", name=search_hits[0]["quote"], exact=True
                )
            ).to_be_visible()
            page.locator("#note-title").fill("Browser note")
            page.locator("#note-content").fill(
                "Created through Playwright against the real API."
            )
            with page.expect_response(
                lambda r: successful_response(
                    r, "POST", workspace_url.removesuffix("workspace") + "notes"
                )
            ) as note_saved:
                page.get_by_role("button", name="Save note", exact=True).click()
            assert (
                note_saved.value.json()["content"]
                == "Created through Playwright against the real API."
            )
            expect(
                page.get_by_text(
                    "Created through Playwright against the real API.", exact=True
                )
            ).to_be_visible(timeout=15000)
            # Change to a non-default exact PDF version, not a checkbox count.
            pdf = next(
                source
                for source in loaded["sources"]
                if source["title"] == "fixture_a.pdf"
            )
            chosen = pdf["versions"][0]["source_version_id"]
            before_ids = loaded["selection"]["source_version_ids"]
            selection_url = workspace_url.removesuffix("workspace") + "selection"
            expected_ids = sorted(set(before_ids) ^ {chosen})
            assert expected_ids and chosen not in before_ids
            with page.expect_response(
                lambda r: successful_response(r, "PATCH", selection_url)
            ) as saved:
                page.get_by_role(
                    "checkbox", name=f"fixture_a.pdf · {chosen}", exact=True
                ).check()
            assert sorted(saved.value.json()["source_version_ids"]) == expected_ids
            reloaded = loaded_workspace(page.reload, workspace_url)
            assert sorted(reloaded["selection"]["source_version_ids"]) == expected_ids
            expect(
                page.get_by_role(
                    "checkbox", name=f"fixture_a.pdf · {chosen}", exact=True
                )
            ).to_be_checked()
            expect(
                page.get_by_text(
                    "Created through Playwright against the real API.", exact=True
                )
            ).to_be_visible()
            typed_fixture = run_typed_unsafe_fixture(page, guard, out)
            for case in json.loads(Path(args.navigation_cases).read_text()):
                page.get_by_role(
                    "button",
                    name=f"{case['source_title']} · {case['citation_id']}",
                    exact=True,
                ).click()
                expect(page.locator("#physical-page")).to_have_value(
                    str(case["physical_page"]), timeout=15000
                )
                expect(reader_version()).to_have_text(case["source_version_id"])
                expect(
                    page.get_by_text(case["quote"], exact=True).first
                ).to_be_visible()
                assert_pdf_page(case["physical_page"])
                location_checks.append(case)
            assert len(location_checks) == 10
            invalid_source = page.get_by_role("article").filter(
                has=page.get_by_role("heading", name="fixture_invalid.pdf", exact=True)
            )
            invalid_source.get_by_role("button", name="Read", exact=True).click()
            expect(page.locator('[data-pdf-fallback="true"]')).to_be_visible(
                timeout=15000
            )
            page.get_by_role(
                "button", name="fixture_a.pdf · PDF_NAV", exact=True
            ).click()
            expect(page.locator("#physical-page")).to_have_value("3", timeout=15000)
            assert_pdf_page(3)
            page.locator("#physical-page").fill("2")
            assert_pdf_page(2)
            # Reparse an old cited version, then upload a newer version. Neither may
            # redirect the saved historical citation to the latest text/page.
            fixture_case = next(
                c for c in location_checks if c["source_title"] == "fixture_a.pdf"
            )
            old_vid = fixture_case["source_version_id"]
            headers = {"Authorization": "Bearer " + guard.password}
            guard.assert_runtime()
            before = context.request.get(
                args.base + "/api/personal/source-versions/" + old_vid, headers=headers
            ).json()
            reader_version()
            reparse_button = page.get_by_role(
                "button", name="Re-extract original", exact=True
            )
            with page.expect_response(
                lambda r: r.request.method == "POST" and r.url.endswith("/reparse")
            ) as operation:
                reparse_button.click()
            reparse_job = operation.value.json()["job_id"]
            expect(
                page.get_by_text(
                    "A new extraction is ready. Historical citations still open their original extraction.",
                    exact=True,
                )
            ).to_be_visible(timeout=30000)
            guard.assert_runtime()
            after = context.request.get(
                args.base + "/api/personal/source-versions/" + old_vid, headers=headers
            ).json()
            assert (
                before["extraction"]["extraction_id"]
                != after["extraction"]["extraction_id"]
            )
            page.get_by_role(
                "button", name="fixture_a.pdf · PDF_NAV", exact=True
            ).click()
            expect(page.locator("#physical-page")).to_have_value("3")
            assert_pdf_page(3)
            source_card = page.get_by_role("article").filter(
                has=page.get_by_role("heading", name="fixture_a.pdf", exact=True)
            )
            source_card.get_by_text("Versions and source details", exact=True).click()
            source_card.get_by_label(
                "Upload a new version", exact=True
            ).set_input_files(
                str(
                    Path(__file__).resolve().parents[2]
                    / "tests/fixtures/v1/fixture_b.pdf"
                )
            )
            expect(
                source_card.get_by_role("button", name="Read", exact=True)
            ).to_have_count(2, timeout=30000)
            page.get_by_role(
                "button", name="fixture_a.pdf · PDF_NAV", exact=True
            ).click()
            expect(reader_version()).to_have_text(old_vid)
            expect(page.locator("#physical-page")).to_have_value("3")
            assert_pdf_page(3)
            maintenance_checks.append(
                {
                    "operation": "reparse-and-new-version",
                    "job_id": reparse_job,
                    "historical_version": old_vid,
                    "old_extraction": before["extraction"]["extraction_id"],
                    "fresh_extraction": after["extraction"]["extraction_id"],
                    "historical_page_preserved": 3,
                }
            )
            page.screenshot(path=str(out / "02-desktop-workbench.png"), full_page=True)
            open_notebook_tools()
            page.get_by_text("Project backup", exact=True).click()
            page.get_by_role("button", name="Export project", exact=True).click()
            download_button = page.get_by_role(
                "button", name="Download project package", exact=True
            ).first
            expect(download_button).to_be_visible(timeout=30000)
            with page.expect_download() as download_info:
                download_button.click()
            exported = out / "browser-project.zip"
            download_info.value.save_as(str(exported))
            assert exported.stat().st_size > 1000
            page.locator('summary[aria-label="Notebook tools"]').click()
            page.set_viewport_size({"width": 390, "height": 844})
            page.get_by_role("tab", name="Sources", exact=True).click()
            expect(
                page.get_by_role("button", name="Read", exact=True).first
            ).to_be_visible()
            assert_mobile_layout("sources-en-US")
            page.get_by_role("button", name="Navigation", exact=True).click()
            expect(page.get_by_role("dialog")).to_be_visible()
            page.keyboard.press("Escape")
            expect(page.get_by_role("dialog")).not_to_be_visible()
            assert_mobile_layout("navigation-closed-en-US")
            page.screenshot(path=str(out / "03-mobile-sources.png"), full_page=True)
            page.get_by_role("tab", name="Notes & results", exact=True).click()
            expect(page.locator("#note-content")).to_be_visible()
            assert_mobile_layout("notes-en-US")
            page.set_viewport_size({"width": 1440, "height": 1000})
            open_notebook_tools()
            page.locator(
                'input[type=file][accept=".zip,application/zip"]'
            ).set_input_files(str(exported))
            confirm_restore = page.get_by_role("dialog").get_by_role(
                "button", name="Confirm", exact=True
            )
            expect(confirm_restore).to_be_enabled(timeout=15000)
            confirm_restore.click()
            restored_link = page.get_by_role(
                "link", name="Open restored notebook", exact=True
            )
            expect(restored_link).to_be_visible(timeout=30000)
            restored_href = restored_link.get_attribute("href")
            restored_id = restored_href.split("/notebooks/")[1].split("/")[0]
            restored_workspace_url = (
                args.base + "/api/personal/notebooks/" + restored_id + "/workspace"
            )
            restored_data = loaded_workspace(
                restored_link.click, restored_workspace_url
            )
            restored_ids = {
                citation["citation_id"]: citation["source_version_id"]
                for note in restored_data["notes"]
                for citation in note.get("citations", [])
            }
            for case in json.loads(Path(args.navigation_cases).read_text()):
                page.get_by_role(
                    "button",
                    name=f"{case['source_title']} · {case['citation_id']}",
                    exact=True,
                ).click()
                expect(page.locator("#physical-page")).to_have_value(
                    str(case["physical_page"]), timeout=15000
                )
                expect(
                    page.get_by_text("Reference: unverified", exact=True)
                ).to_be_visible()
                expect(
                    page.get_by_text(case["quote"], exact=True).first
                ).to_be_visible()
                assert_pdf_page(case["physical_page"])
                expect(reader_version()).to_have_text(restored_ids[case["citation_id"]])
                restored_version = reader_version().inner_text()
                assert (
                    restored_version and restored_version != case["source_version_id"]
                )
                restored_location_checks.append(
                    {**case, "restored_source_version_id": restored_version}
                )
                if case["citation_id"] == "LOC_a_5":
                    page.screenshot(
                        path=str(out / "04a-restored-subquote.png"), full_page=True
                    )
            assert len(restored_location_checks) == 10
            page.get_by_role(
                "button", name="fixture_a.pdf · PDF_NAV", exact=True
            ).click()
            expect(page.locator("#physical-page")).to_have_value("3", timeout=15000)
            expect(
                page.get_by_text("Reference: unverified", exact=True)
            ).to_be_visible()
            assert_pdf_page(3)
            page.screenshot(path=str(out / "04-restored-reference.png"), full_page=True)
            # Revalidate through the real UI/worker and verify persistence without
            # editing the archived note or accepting its previous verified badge.
            restored_vid = reader_version().inner_text()
            with page.expect_response(
                lambda r: r.request.method == "POST" and r.url.endswith("/revalidate")
            ) as operation:
                page.get_by_role(
                    "button", name="Revalidate archived references", exact=True
                ).click()
            revalidation_job = operation.value.json()["job_id"]
            expect(page.get_by_text("Reference: verified", exact=True)).to_be_visible(
                timeout=30000
            )
            expect(page.locator("#physical-page")).to_have_value("3")
            assert_pdf_page(3)
            guard.assert_runtime()
            job_detail = context.request.get(
                args.base + "/api/personal/jobs/" + revalidation_job, headers=headers
            ).json()
            assert (
                job_detail["state"] == "succeeded"
                and job_detail["result"]["verified_count"] > 0
            )
            page.screenshot(
                path=str(out / "04b-revalidated-reference.png"), full_page=True
            )
            # A reparse continues server-side if we navigate away; it must never
            # replace the other citation's reader when the old request finishes.
            with page.expect_response(
                lambda r: r.request.method == "POST" and r.url.endswith("/reparse")
            ) as operation:
                page.get_by_role(
                    "button", name="Re-extract original", exact=True
                ).click()
            navigation_job = operation.value.json()["job_id"]
            page.get_by_role(
                "button", name="fixture_b.pdf · LOC_b_1", exact=True
            ).click()
            expect(reader_version()).to_have_text(restored_ids["LOC_b_1"])
            other_vid = reader_version().inner_text()
            assert other_vid != restored_vid
            page.wait_for_timeout(2500)
            expect(reader_version()).to_have_text(other_vid)
            loaded_workspace(page.reload, restored_workspace_url)
            page.get_by_role(
                "button", name="fixture_a.pdf · PDF_NAV", exact=True
            ).click()
            expect(page.get_by_text("Reference: verified", exact=True)).to_be_visible(
                timeout=15000
            )
            expect(page.locator("#physical-page")).to_have_value("3")
            assert_pdf_page(3)
            maintenance_checks.append(
                {
                    "operation": "restore-revalidate-navigate-reload",
                    "job_id": revalidation_job,
                    "navigation_job_id": navigation_job,
                    "restored_version": restored_vid,
                    "result": job_detail["result"],
                    "historical_page_preserved": 3,
                }
            )

            with page.expect_popup() as popup:
                page.get_by_role("link", name="Settings", exact=True).click()
            settings = popup.value
            settings.get_by_role(
                "button", name="Language Toggle language", exact=True
            ).click()
            settings.get_by_role("menuitem", name="简体中文", exact=True).click()
            expect(
                settings.get_by_role("button", name="主题 主题", exact=True)
            ).to_be_visible()
            loaded_workspace(page.reload, restored_workspace_url)
            expect(page.locator('[aria-label="学习工作台"]')).to_be_visible()
            page.locator("#workbench-panel-conversation").get_by_role(
                "button", name="阅读", exact=True
            ).click()
            page.locator('summary[aria-label="笔记本工具"]').click()
            page.get_by_text("项目备份", exact=True).press("Enter")
            expect(
                page.get_by_role("button", name="导出项目", exact=True)
            ).to_be_visible()
            expect(
                page.get_by_text("导出包含已保存的原件", exact=False)
            ).to_be_visible()
            page.get_by_text("项目备份", exact=True).press("Enter")
            expect(
                page.get_by_role("button", name="导出项目", exact=True)
            ).not_to_be_visible()
            page.locator('summary[aria-label="笔记本工具"]').click()
            for selector in (
                "#workbench-panel-sources",
                "#workbench-panel-conversation",
                "#workbench-panel-notes",
            ):
                page.locator(selector).evaluate("element => element.scrollTop = 0")
            assert_viewport_height("desktop-zh-CN")
            page.screenshot(path=str(out / "05-desktop-zh-CN.png"), full_page=True)
            settings.get_by_role("button", name="主题 主题", exact=True).click()
            settings.get_by_role("menuitem", name="深色", exact=True).click()
            loaded_workspace(page.reload, restored_workspace_url)
            expect(page.locator("html")).to_have_class(
                re.compile(r"(?:^|\s)dark(?:\s|$)")
            )
            page.locator("#workbench-panel-conversation").get_by_role(
                "button", name="阅读", exact=True
            ).click()
            page.screenshot(path=str(out / "05b-desktop-dark-zh-CN.png"))
            settings.get_by_role("button", name="主题 主题", exact=True).click()
            settings.get_by_role("menuitem", name="浅色", exact=True).click()
            loaded_workspace(page.reload, restored_workspace_url)
            expect(page.locator("html")).not_to_have_class(
                re.compile(r"(?:^|\s)dark(?:\s|$)")
            )
            page.locator("#workbench-panel-conversation").get_by_role(
                "button", name="阅读", exact=True
            ).click()
            settings.close()
            page.set_viewport_size({"width": 1024, "height": 900})
            expect(
                page.get_by_role("tab", name="阅读与提问", exact=True)
            ).to_be_visible()
            expect(page.locator("#workbench-panel-sources")).not_to_be_visible()
            assert (
                page.locator("#workbench-panel-conversation").bounding_box()["width"]
                > 500
            )
            assert_viewport_height("tablet-zh-CN")
            page.screenshot(path=str(out / "05c-tablet-zh-CN.png"), full_page=True)
            page.set_viewport_size({"width": 390, "height": 844})
            page.get_by_role("tab", name="资料", exact=True).click()
            expect(
                page.get_by_text("选择下一次提问需要使用的资料。", exact=True)
            ).to_be_visible()
            assert_mobile_layout("sources-zh-CN")
            assert_viewport_height("sources-zh-CN")
            assert page.locator("header").bounding_box()["height"] < 280
            page.get_by_role("button", name="导航菜单", exact=True).click()
            expect(page.get_by_role("dialog")).to_be_visible()
            page.keyboard.press("Escape")
            expect(page.get_by_role("dialog")).not_to_be_visible()
            page.screenshot(
                path=str(out / "06-mobile-sources-zh-CN.png"), full_page=True
            )
            page.get_by_role("tab", name="阅读与提问", exact=True).click()
            expect(page.get_by_text("PDF 物理页", exact=True)).to_be_visible()
            assert_pdf_page(3)
            assert_mobile_layout("reader-zh-CN", reader=True)
            assert_viewport_height("reader-zh-CN")
            page.screenshot(
                path=str(out / "07-mobile-reader-zh-CN.png"), full_page=True
            )
            page.locator("canvas[data-page-number]").scroll_into_view_if_needed()
            page.screenshot(path=str(out / "08-mobile-pdf-zh-CN.png"), full_page=True)
            (out / "viewport-checks.json").write_text(
                json.dumps(viewport_checks, indent=2)
            )
            assert not errors, errors
        except Exception:
            page.screenshot(path=str(out / "failure.png"), full_page=True)
            (out / "failure.txt").write_text(
                page.url
                + "\n"
                + page.locator("body").inner_text()
                + "\n"
                + repr(errors)
            )
            raise
        finally:
            browser.close()

    guard.recheck()
    (out / "browser-results.json").write_text(
        json.dumps(
            {
                "status": "passed",
                "acceptance_identity": guard.evidence,
                "browser_engine": args.engine,
                "actions": [
                    "Explicit reparse, newer-version upload, historical citation preservation, restored citation fresh-original revalidation and navigation/reload persistence verified",
                    "Anonymous page redirected to login",
                    "Password login via form",
                    "Real original reader opened",
                    "Lexical search via UI",
                    "Note saved through UI",
                    "Selection and note survived refresh",
                    "Ten known references across two PDFs opened their exact immutable version, quote and physical page with nonblank PDF.js raster",
                    "PDF.js rendered nonblank raster for physical page 3 and page 2 after manual navigation",
                    "Malformed PDF displays explicit text/download fallback instead of blank preview",
                    "Export queued via UI",
                    "Export completed and ZIP downloaded through authenticated UI",
                    "390px sources, notes and reader use full width without horizontal overflow; mobile navigation drawer opens and closes via Escape",
                    "Visible locale menu switched to Chinese; desktop/mobile labels and layouts verified",
                    "Downloaded ZIP restored through UI; ten archived whole-quote/subquote references open remapped versions and correct physical pages while remaining unverified",
                ],
                "mocked_typed_500_ui_fixture": typed_fixture,
                "selection_check": {
                    "source_version_ids": expected_ids,
                    "selected_pdf": chosen,
                },
                "maintenance_checks": maintenance_checks,
                "page_errors": errors,
                "pdf_raster_checks": raster_checks,
                "mobile_layout_checks": mobile_checks,
                "known_reference_checks": location_checks,
                "restored_reference_checks": restored_location_checks,
            },
            indent=2,
        )
    )
    print("Browser checks passed; screenshots: " + str(out))


if __name__ == "__main__":
    main()

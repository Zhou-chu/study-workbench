"""Real Playwright actions against isolated native stack; public fixtures only."""

import argparse
import json
import os
import tempfile
from pathlib import Path
from urllib.parse import quote

from playwright.sync_api import expect, sync_playwright

p = argparse.ArgumentParser()
p.add_argument("--base", required=True)
p.add_argument("--notebook", required=True)
p.add_argument("--out", required=True)
p.add_argument("--navigation-cases", required=True)
p.add_argument(
    "--engine",
    choices=["chromium", "firefox"],
    default=os.environ.get("STUDY_WORKBENCH_BROWSER", "chromium"),
)
args = p.parse_args()
out = Path(args.out)
out.mkdir(parents=True, exist_ok=True)
with sync_playwright() as pw:
    profile_home = tempfile.mkdtemp(prefix="sw-browser-home-", dir="/tmp")
    launch_options = {
        "headless": True,
        "env": {
            **os.environ,
            "HOME": profile_home,
            "XDG_CONFIG_HOME": profile_home + "/config",
            "XDG_CACHE_HOME": profile_home + "/cache",
        },
    }
    if args.engine == "chromium":
        launch_options["executable_path"] = "/usr/bin/chromium"
    browser = getattr(pw, args.engine).launch(**launch_options)
    context = browser.new_context(
        viewport={"width": 1440, "height": 1000}, locale="en-US"
    )
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
        (out / "viewport-checks.json").write_text(json.dumps(viewport_checks, indent=2))
        assert metrics["document_height"] <= metrics["viewport"] + 1, metrics
        assert metrics["body_height"] <= metrics["viewport"] + 1, metrics

    def assert_pdf_page(number):
        canvas = page.locator("canvas[data-page-number]")
        expect(canvas).to_have_attribute("data-page-number", str(number), timeout=15000)
        expect(canvas).to_have_attribute("data-render-state", "ready", timeout=30000)
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
        assert pixels > 100, ("Blank PDF raster", pixels)
        raster_checks.append({"physical_page": number, "nonwhite_pixels": pixels})

    def assert_mobile_layout(label, reader=False):
        metrics = page.evaluate("""() => {
            const visible = element => element.getClientRects().length > 0;
            const main = document.querySelector('main');
            const panels = [...document.querySelectorAll('main main, main aside')].filter(visible);
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
        mobile_checks.append({"view": label, **metrics})

    target = args.base + "/notebooks/" + quote(args.notebook, safe="") + "/study"
    try:
        page.goto(target)
        page.locator("input[type=password]").wait_for(timeout=30000)
        assert "/login" in page.url, page.url
        page.screenshot(path=str(out / "01-private-login.png"), full_page=True)
        page.locator("input[type=password]").fill("test-only-local-fixture")
        page.locator("button[type=submit]").click()
        page.wait_for_url(lambda url: "/login" not in url, timeout=30000)
        page.goto(target)
        expect(page.get_by_text("StudyWorkbench", exact=False)).to_be_visible(
            timeout=30000
        )
        expect(page.get_by_text("fixture_course.md", exact=True).first).to_be_visible()
        page.get_by_role("button", name="Read", exact=True).first.click()
        expect(
            page.get_by_role("button", name="Download original version", exact=True)
        ).to_be_visible(timeout=15000)
        page.locator("#workspace-search").fill("证据")
        page.get_by_role("button", name="Search", exact=True).click()
        page.wait_for_timeout(1000)
        page.locator("#note-title").fill("Browser note")
        page.locator("#note-content").fill(
            "Created through Playwright against the real API."
        )
        page.get_by_role("button", name="Save note", exact=True).click()
        expect(
            page.get_by_text(
                "Created through Playwright against the real API.", exact=True
            )
        ).to_be_visible(timeout=15000)
        selected = page.locator("input[type=checkbox]:checked").count()
        assert selected > 0
        page.reload()
        expect(page.get_by_text("StudyWorkbench", exact=False)).to_be_visible(
            timeout=15000
        )
        assert page.locator("input[type=checkbox]:checked").count() == selected
        expect(
            page.get_by_text(
                "Created through Playwright against the real API.", exact=True
            )
        ).to_be_visible()
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
                page.locator("main main").locator(
                    f'[title="{case["source_version_id"]}"]'
                )
            ).to_be_visible()
            expect(page.get_by_text(case["quote"], exact=True).first).to_be_visible()
            assert_pdf_page(case["physical_page"])
            location_checks.append(case)
        assert len(location_checks) == 10
        invalid_source = page.get_by_text(
            "fixture_invalid.pdf", exact=True
        ).first.locator("..")
        invalid_source.get_by_role("button", name="Read", exact=True).click()
        expect(page.locator('[data-pdf-fallback="true"]')).to_be_visible(timeout=15000)
        page.get_by_role("button", name="fixture_a.pdf · PDF_NAV", exact=True).click()
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
        headers = {"Authorization": "Bearer test-only-local-fixture"}
        before = context.request.get(
            args.base + "/api/personal/source-versions/" + old_vid, headers=headers
        ).json()
        page.get_by_text("Document tools", exact=True).click()
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
        after = context.request.get(
            args.base + "/api/personal/source-versions/" + old_vid, headers=headers
        ).json()
        assert (
            before["extraction"]["extraction_id"]
            != after["extraction"]["extraction_id"]
        )
        page.get_by_role("button", name="fixture_a.pdf · PDF_NAV", exact=True).click()
        expect(page.locator("#physical-page")).to_have_value("3")
        assert_pdf_page(3)
        source_card = (
            page.locator("aside")
            .get_by_text("fixture_a.pdf", exact=True)
            .first.locator("..")
        )
        source_card.get_by_label("Upload a new version", exact=True).set_input_files(
            str(Path(__file__).resolve().parents[2] / "tests/fixtures/v1/fixture_b.pdf")
        )
        expect(
            source_card.get_by_role("button", name="Read", exact=True)
        ).to_have_count(2, timeout=30000)
        page.get_by_role("button", name="fixture_a.pdf · PDF_NAV", exact=True).click()
        expect(page.locator("main main p[title]")).to_have_attribute("title", old_vid)
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
        page.get_by_text("Project backup", exact=True).click()
        page.get_by_role("button", name="Export project", exact=True).click()
        expect(page.get_by_text("portable_export", exact=False).first).to_be_visible(
            timeout=20000
        )
        download_button = page.get_by_role(
            "button", name="Download result", exact=True
        ).first
        expect(download_button).to_be_visible(timeout=30000)
        with page.expect_download() as download_info:
            download_button.click()
        exported = out / "browser-project.zip"
        download_info.value.save_as(str(exported))
        assert exported.stat().st_size > 1000
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
        page.locator('input[type=file][accept=".zip,application/zip"]').set_input_files(
            str(exported)
        )
        page.get_by_role("dialog").get_by_role(
            "button", name="Confirm", exact=True
        ).click()
        restored_link = page.get_by_role(
            "link", name="Open restored notebook", exact=True
        )
        expect(restored_link).to_be_visible(timeout=30000)
        restored_link.click()
        expect(page.get_by_text("StudyWorkbench", exact=False)).to_be_visible(
            timeout=15000
        )
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
            expect(page.get_by_text(case["quote"], exact=True).first).to_be_visible()
            assert_pdf_page(case["physical_page"])
            restored_version = page.locator("main main p[title]").get_attribute("title")
            assert restored_version and restored_version != case["source_version_id"]
            restored_location_checks.append(
                {**case, "restored_source_version_id": restored_version}
            )
            if case["citation_id"] == "LOC_a_5":
                page.screenshot(
                    path=str(out / "04a-restored-subquote.png"), full_page=True
                )
        assert len(restored_location_checks) == 10
        page.get_by_role("button", name="fixture_a.pdf · PDF_NAV", exact=True).click()
        expect(page.locator("#physical-page")).to_have_value("3", timeout=15000)
        expect(page.get_by_text("Reference: unverified", exact=True)).to_be_visible()
        assert_pdf_page(3)
        page.screenshot(path=str(out / "04-restored-reference.png"), full_page=True)
        # Revalidate through the real UI/worker and verify persistence without
        # editing the archived note or accepting its previous verified badge.
        restored_vid = page.locator("main main p[title]").get_attribute("title")
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
        job_detail = context.request.get(
            args.base + "/api/personal/jobs/" + revalidation_job, headers=headers
        ).json()
        assert (
            job_detail["state"] == "succeeded"
            and job_detail["result"]["verified_count"] > 0
        )
        page.screenshot(path=str(out / "04b-revalidated-reference.png"), full_page=True)
        # A reparse continues server-side if we navigate away; it must never
        # replace the other citation's reader when the old request finishes.
        with page.expect_response(
            lambda r: r.request.method == "POST" and r.url.endswith("/reparse")
        ) as operation:
            page.get_by_role("button", name="Re-extract original", exact=True).click()
        navigation_job = operation.value.json()["job_id"]
        page.get_by_role("button", name="fixture_b.pdf · LOC_b_1", exact=True).click()
        other_vid = page.locator("main main p[title]").get_attribute("title")
        assert other_vid != restored_vid
        page.wait_for_timeout(2500)
        expect(page.locator("main main p[title]")).to_have_attribute("title", other_vid)
        page.reload()
        page.get_by_role("button", name="fixture_a.pdf · PDF_NAV", exact=True).click()
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

        page.get_by_role("button", name="Language Toggle language", exact=True).click()
        page.get_by_role("menuitem", name="简体中文", exact=True).click()
        page.get_by_role("menu").wait_for(state="detached")
        expect(page.get_by_text("学习工作台", exact=False)).to_be_visible()
        page.get_by_text("项目备份", exact=True).press("Enter")
        expect(page.get_by_role("button", name="导出项目", exact=True)).to_be_visible()
        expect(page.get_by_text("导出包含已保存的原件", exact=False)).to_be_visible()
        page.get_by_text("项目备份", exact=True).press("Enter")
        expect(
            page.get_by_role("button", name="导出项目", exact=True)
        ).not_to_be_visible()
        for selector in (
            "#workbench-panel-sources",
            "#workbench-panel-conversation",
            "#workbench-panel-notes",
        ):
            page.locator(selector).evaluate("element => element.scrollTop = 0")
        assert_viewport_height("desktop-zh-CN")
        page.screenshot(path=str(out / "05-desktop-zh-CN.png"), full_page=True)
        page.evaluate("document.documentElement.classList.add('dark')")
        page.wait_for_timeout(400)
        page.screenshot(path=str(out / "05b-desktop-dark-zh-CN.png"))
        page.evaluate("document.documentElement.classList.remove('dark')")
        page.wait_for_timeout(400)
        page.set_viewport_size({"width": 1024, "height": 900})
        expect(page.get_by_role("tab", name="对话", exact=True)).to_be_visible()
        expect(page.locator("#workbench-panel-sources")).not_to_be_visible()
        assert (
            page.locator("#workbench-panel-conversation").bounding_box()["width"] > 500
        )
        assert_viewport_height("tablet-zh-CN")
        page.screenshot(path=str(out / "05c-tablet-zh-CN.png"), full_page=True)
        page.set_viewport_size({"width": 390, "height": 844})
        page.get_by_role("tab", name="资料", exact=True).click()
        expect(page.get_by_text("资料范围", exact=True)).to_be_visible()
        assert_mobile_layout("sources-zh-CN")
        assert_viewport_height("sources-zh-CN")
        assert page.locator("header").bounding_box()["height"] < 280
        page.get_by_role("button", name="导航菜单", exact=True).click()
        expect(page.get_by_role("dialog")).to_be_visible()
        page.keyboard.press("Escape")
        expect(page.get_by_role("dialog")).not_to_be_visible()
        page.screenshot(path=str(out / "06-mobile-sources-zh-CN.png"), full_page=True)
        page.get_by_role("tab", name="对话", exact=True).click()
        expect(page.get_by_text("PDF 物理页", exact=True)).to_be_visible()
        assert_pdf_page(3)
        assert_mobile_layout("reader-zh-CN", reader=True)
        assert_viewport_height("reader-zh-CN")
        page.screenshot(path=str(out / "07-mobile-reader-zh-CN.png"), full_page=True)
        page.locator("canvas[data-page-number]").scroll_into_view_if_needed()
        page.screenshot(path=str(out / "08-mobile-pdf-zh-CN.png"), full_page=True)
        (out / "viewport-checks.json").write_text(json.dumps(viewport_checks, indent=2))
        assert not errors, errors
        (out / "browser-results.json").write_text(
            json.dumps(
                {
                    "status": "passed",
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
    except Exception:
        page.screenshot(path=str(out / "failure.png"), full_page=True)
        (out / "failure.txt").write_text(
            page.url + "\n" + page.locator("body").inner_text() + "\n" + repr(errors)
        )
        raise
    finally:
        browser.close()

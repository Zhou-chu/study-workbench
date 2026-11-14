"""Synthetic-only UI screenshot review. Never connects to a user's backend or profile."""

import json
import os
import re
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:18864"
ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / ".superpowers/sdd/notebook-spa-redesign/editorial-review"
OUT.mkdir(parents=True, exist_ok=True)
FONTS = Path(
    os.environ.get(
        "QA_FONT_DIR", str(ROOT / ".superpowers/sdd/notebook-spa-redesign/fonts")
    )
)
notebooks = [
    {
        "id": "n",
        "name": "控制系统 · 从观察到理解",
        "description": "在阅读、提问与记录之间，建立自己的知识脉络。",
        "archived": False,
        "created": "2026-11-01",
        "updated": "2026-11-10",
        "source_count": 3,
        "note_count": 2,
    },
    {
        "id": "n2",
        "name": "设计中的秩序",
        "description": "关于留白、层级和日常物件的阅读笔记。",
        "archived": False,
        "created": "2026-10-01",
        "updated": "2026-11-09",
        "source_count": 6,
        "note_count": 4,
    },
    {
        "id": "n3",
        "name": "阅读与思考",
        "description": "把零散的观点整理成可以继续生长的问题。",
        "archived": False,
        "created": "2026-10-01",
        "updated": "2026-11-08",
        "source_count": 2,
        "note_count": 1,
    },
]
scope = {
    "engine": "independent",
    "selection_origin": "local",
    "source_version_ids": ["v1", "v2"],
    "remote_source_ids": [],
}
sources = [
    {
        "source_id": f"s{i}",
        "title": title,
        "versions": [
            {
                "source_id": f"s{i}",
                "source_version_id": f"v{i}",
                "notebook_id": "n",
                "created_at": "2026-11-08T10:00:00Z",
                "origin": "upload",
                "status": "ready",
                "extraction_status": "ready",
                "original_status": "available",
            }
        ],
    }
    for i, title in enumerate(
        ["反馈系统导论.pdf", "稳定性与动态响应.md", "课堂笔记 · 第三章"], 1
    )
]
notes = [
    {
        "id": "note:one",
        "notebook_id": "n",
        "title": "理解反馈的三个关键问题",
        "content": "反馈不是简单地把输出送回输入，而是不断比较目标与实际结果。\n\n### 接下来要想清楚的事\n\n- 反馈如何改变系统对扰动的响应？\n- 稳定性与响应速度之间有什么取舍？\n- 何时需要重新检查模型的假设？",
        "revision": 1,
        "citations": [],
        "scope_snapshot": scope,
    },
    {
        "id": "note:two",
        "notebook_id": "n",
        "title": "阅读摘记：从局部到整体",
        "content": "先观察一个环节，再把它放回整体。理解联系，比记住孤立的结论更重要。",
        "revision": 1,
        "citations": [],
        "scope_snapshot": scope,
    },
]
turn = {
    "turn_id": "turn:one",
    "notebook_id": "n",
    "status": "succeeded",
    "message": "如何直观理解负反馈的作用？",
    "answer": "负反馈可以理解为一种持续的自我校正。系统先观察当前结果，再把它与目标比较，并据此调整下一步行动。\n\n### 从一个简单例子开始\n\n恒温器会测量室温。低于目标时增加供热，高于目标时减少供热。关键不只是控制动作，而是**观察、比较、调整**形成的闭环。\n\n在控制系统中，这种机制有助于减小扰动的影响，但反馈强度和响应延迟也会影响稳定性。",
    "citations": [],
    "scope_snapshot": scope,
}
workspace = {
    "schema_version": "workspace-view-v1",
    "notebook": notebooks[0],
    "sources": sources,
    "notes": notes,
    "turns": [turn],
    "jobs": [
        {
            "job_id": "job:internal-do-not-display",
            "operation": "background_extract",
            "state": "succeeded",
        }
    ],
    "selection": scope,
    "link": None,
    "legacy_history": [],
}
requests = []


def api(route):
    p = urlparse(route.request.url).path
    requests.append({"path": p, "method": route.request.method})
    value = {}
    if p.endswith("spa-artifact-manifest.json"):
        value = {
            "schema_version": "spa-artifact-v1",
            "source_commit": "a" * 40,
            "authored_digest": "b" * 64,
            "asset_digest": "c" * 64,
            "contract_digest": "d" * 64,
            "ui_transport_protocol": 1,
            "supported_contracts": ["workspace-view-v1"],
        }
    elif p == "/config":
        value = {
            "apiUrl": "",
            "auth_mode": "legacy_password",
            "web_session_protocol": None,
            "client_contracts": ["workspace-view-v1"],
            "ui_transport_protocol": 1,
        }
    elif p.endswith("/auth/status"):
        value = {"auth_enabled": False}
    elif p.endswith("/client-capabilities"):
        value = {
            "contract_version": "client-capabilities-v1",
            "supported_contracts": ["workspace-view-v1"],
            "limits": {
                "source_upload_max_bytes": 50000000,
                "portable": {
                    "max_archive_bytes": 50000000,
                    "max_expanded_bytes": 100000000,
                    "max_entity_bytes": 50000000,
                    "max_manifest_bytes": 1000000,
                    "max_request_bytes": 60000000,
                    "multipart_overhead_bytes": 1000000,
                    "max_entries": 1000,
                    "max_compression_ratio": 100,
                },
            },
        }
    elif p == "/api/personal/source-versions/v1":
        value = {
            "version": {
                "source_version_id": "v1",
                "source_id": "s1",
                "notebook_id": "n",
                "source_title": "反馈系统导论.pdf",
                "mime_type": "text/plain",
                "original_status": "missing",
                "current_extraction_id": "x1",
            },
            "extraction": {
                "extraction_id": "x1",
                "source_version_id": "v1",
                "status": "ready",
                "page_count": 1,
                "text": "反馈系统导论\n\n反馈是一种用观测结果调整行为的机制。理解一个反馈系统，需要同时关注目标、测量和控制动作。\n\n1. 观察当前状态\n2. 比较实际与目标\n3. 调整控制输入\n\n在阅读时，把抽象概念与具体的例子放在一起。恒温器、速度控制和生物调节都可以成为理解闭环系统的起点。",
                "blocks": [],
            },
            "evidence": [],
        }
    elif p.endswith("/workspace-view"):
        value = workspace
    elif p == "/api/notebooks":
        value = notebooks
    elif p == "/api/notebooks/n":
        value = notebooks[0]
    elif p.endswith("/recently-viewed"):
        value = [
            {
                "type": "notebook",
                "id": "n",
                "title": notebooks[0]["name"],
                "last_viewed_at": "2026-11-10T09:00:00Z",
            }
        ]
    elif p.endswith("/models/defaults"):
        value = {
            "default_chat_model": "model:qa",
            "default_embedding_model": None,
            "default_transformation_model": None,
            "default_tools_model": None,
            "large_context_model": None,
            "default_text_to_speech_model": None,
            "default_speech_to_text_model": None,
        }
    elif p.endswith("/models"):
        value = [
            {
                "id": "model:qa",
                "name": "Local preview model",
                "provider": "openai",
                "type": "language",
                "credential": None,
                "created": "2026-11-10",
                "updated": "2026-11-10",
            }
        ]
    elif p.endswith("/credentials/status"):
        value = {
            "configured": {"openai": True},
            "source": {"openai": "env"},
            "encryption_configured": True,
        }
    elif p.endswith("/credentials/env-status"):
        value = {}
    elif p.endswith("/turns"):
        value = []
    elif p.endswith("/sources"):
        value = []
    elif p.endswith("/notes"):
        value = notes
    elif (
        p.endswith("/episodes")
        or p.endswith("/episode-profiles")
        or p.endswith("/speaker-profiles")
        or p.endswith("/transformations")
    ):
        value = []
    elif p.endswith("/settings"):
        value = {
            "default_content_processing_engine_doc": "auto",
            "default_content_processing_engine_url": "auto",
            "default_embedding_option": "ask",
            "auto_delete_files": "no",
            "docling_ocr": True,
            "docling_formulas": False,
            "docling_vision": False,
            "youtube_preferred_languages": ["zh"],
        }
    elif p == "/api/capabilities":
        value = {
            "docling_available": True,
            "crawl4ai_available": False,
            "crawl4ai_remote_configured": False,
        }
    elif p.endswith("/web-search/status"):
        value = {
            "state": "ready",
            "provider": "firecrawl",
            "configured": True,
            "access_mode": "keyless_trial",
            "trial_limits": {
                "scope": "server_ip",
                "period": "daily",
                "numeric_caps_published": False,
            },
            "automatic_paid_fallback": False,
            "reason": None,
            "settings_url": "/settings#web-search",
            "max_results": 10,
            "externally_verified": False,
        }
    elif p == "/api/providers":
        value = [
            {
                "name": "openai",
                "display_name": "OpenAI",
                "modalities": ["language", "embedding"],
                "docs_url": "https://platform.openai.com/",
                "env_configured": True,
            }
        ]
    elif p == "/api/credentials":
        value = []
    route.fulfill(status=200, content_type="application/json", body=json.dumps(value))


with sync_playwright() as p:
    browser = p.firefox.launch(headless=True)
    results = []
    for width, height in [
        (w, 1000 if w == 1440 else 900 if w == 1024 else 844)
        for w in map(int, os.environ.get("QA_WIDTHS", "1440,1024,390").split(","))
    ]:
        for theme in os.environ.get("QA_THEMES", "light,dark").split(","):
            context = browser.new_context(
                viewport={"width": width, "height": height},
                locale="zh-CN",
                color_scheme=theme,
            )
            context.route("**/spa-artifact-manifest.json", api)
            context.route("**/config", api)
            context.route("**/api/**", api)

            # Any attempt to reach another origin fails closed.
            def network(route):
                if not route.request.url.startswith(BASE):
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
            context.route(
                "**/qa-chinese.ttf",
                lambda r: r.fulfill(
                    path=str(FONTS / "qa-chinese.ttf"), content_type="font/ttf"
                ),
            )
            page = context.new_page()
            page.set_default_timeout(15000)
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            for name, path in [
                ("home", "/notebooks"),
                ("notebook", "/notebooks/n"),
                ("library", "/sources"),
                ("settings", "/settings"),
                ("models", "/settings/models"),
                ("podcasts", "/podcasts"),
                ("search", "/search"),
            ]:
                if os.environ.get("QA_PAGES") and name not in os.environ[
                    "QA_PAGES"
                ].split(","):
                    continue
                page.goto(BASE + path, wait_until="domcontentloaded", timeout=60000)
                page.wait_for_timeout(1200)
                page.add_style_tag(
                    content="@font-face{font-family:QA;src:url('/qa-font.ttf')}@font-face{font-family:QAChinese;src:url('/qa-chinese.ttf')} *{font-family:QA,QAChinese!important} h1,h2,h3{font-family:QAChinese!important}"
                )
                page.evaluate("document.fonts.ready")
                page.wait_for_timeout(300)
                page.screenshot(
                    path=str(OUT / f"{width}-{theme}-{name}.png"), full_page=True
                )
                print(width, theme, name, flush=True)
                results.append(
                    {
                        "view": name,
                        "width": width,
                        "theme": theme,
                        "overflow": page.evaluate(
                            "document.documentElement.scrollWidth > innerWidth"
                        ),
                        "errors": errors.copy(),
                    }
                )
                if name == "notebook":
                    page.get_by_role("button", name="成果", exact=True).click()
                    page.wait_for_timeout(200)
                    page.screenshot(
                        path=str(OUT / f"{width}-{theme}-notes.png"), full_page=True
                    )
                    results.append(
                        {
                            "view": "notes",
                            "width": width,
                            "theme": theme,
                            "overflow": page.evaluate(
                                "document.documentElement.scrollWidth > innerWidth"
                            ),
                            "errors": errors.copy(),
                        }
                    )
                    assert (
                        "job:internal-do-not-display"
                        not in page.locator("body").inner_text()
                    )
                    # Confirm real editor retains a typed draft when switching sections.
                    page.get_by_role("button", name="新建 笔记", exact=True).click()
                    page.get_by_label("笔记标题", exact=True).fill("正在写的思考")
                    page.get_by_role("button", name="对话", exact=True).click()
                    page.get_by_role("button", name="成果", exact=True).click()
                    assert (
                        page.get_by_label("笔记标题", exact=True).input_value()
                        == "正在写的思考"
                    )
                    page.screenshot(
                        path=str(OUT / f"{width}-{theme}-editor.png"), full_page=True
                    )
                    results.append(
                        {
                            "view": "editor",
                            "width": width,
                            "theme": theme,
                            "overflow": page.evaluate(
                                "document.documentElement.scrollWidth > innerWidth"
                            ),
                            "errors": errors.copy(),
                        }
                    )
                    page.get_by_role("button", name="资料", exact=True).click()
                    page.get_by_role(
                        "button", name="反馈系统导论.pdf", exact=True
                    ).click()
                    page.screenshot(
                        path=str(OUT / f"{width}-{theme}-sources.png"), full_page=True
                    )
                    results.append(
                        {
                            "view": "sources",
                            "width": width,
                            "theme": theme,
                            "overflow": page.evaluate(
                                "document.documentElement.scrollWidth > innerWidth"
                            ),
                            "errors": errors.copy(),
                        }
                    )
                    page.get_by_role(
                        "button", name=re.compile("^阅读 反馈系统导论.pdf")
                    ).click()
                    page.wait_for_timeout(500)
                    page.screenshot(
                        path=str(OUT / f"{width}-{theme}-reader.png"), full_page=False
                    )
                    assert page.locator(".workspace-reader").is_visible()
                    results.append(
                        {
                            "view": "reader",
                            "width": width,
                            "theme": theme,
                            "overflow": page.evaluate(
                                "document.documentElement.scrollWidth > innerWidth"
                            ),
                            "errors": errors.copy(),
                        }
                    )
            context.close()
    browser.close()
    if os.environ.get("QA_PAGES") and (OUT / "report.json").exists():
        previous = json.loads((OUT / "report.json").read_text())
        keys = {(x["view"], x["width"], x["theme"]) for x in results}
        results = [
            x
            for x in previous["results"]
            if (x["view"], x["width"], x["theme"]) not in keys
        ] + results
    (OUT / "report.json").write_text(
        json.dumps(
            {"results": results, "requests": requests}, ensure_ascii=False, indent=2
        )
    )
    assert not any(r["overflow"] or r["errors"] for r in results), (
        "Layout overflow or browser errors: see report.json"
    )
    print(OUT)

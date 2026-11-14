"""Reproducible model setup QA. Every API response is synthetic; no user browser/profile."""

import copy
import hashlib
import json
import os
import pwd
import re
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parents[3]
BASELINE = os.environ.get("QA_BASELINE") == "1"
SOURCE = ROOT
APP = ROOT / "apps/web"
PORT = int(os.environ.get("QA_PORT", "18864"))
BASE = f"http://127.0.0.1:{PORT}"
TOOLS = (Path(pwd.getpwuid(os.getuid()).pw_dir) / "study-workbench-deploy-20261107")
FONTS = (Path(pwd.getpwuid(os.getuid()).pw_dir) / "study-workbench-worktrees-20261108/notebook-editorial-20261110/.superpowers/sdd/notebook-spa-redesign/fonts")
IDENTITY = {
    "schema_version": "spa-artifact-v1",
    "source_commit": "a" * 40,
    "authored_digest": "b" * 64,
    "asset_digest": "c" * 64,
    "contract_digest": "d" * 64,
    "ui_transport_protocol": 1,
    "supported_contracts": ["workspace-view-v1"],
}
DEFAULTS = dict.fromkeys(
    (
        "default_chat_model",
        "default_embedding_model",
        "default_transformation_model",
        "default_tools_model",
        "large_context_model",
        "default_text_to_speech_model",
        "default_speech_to_text_model",
    )
)
PROVIDERS = [
    {
        "name": "openai",
        "display_name": "OpenAI",
        "modalities": ["language", "embedding"],
        "docs_url": None,
        "env_configured": False,
    },
    {
        "name": "deepseek",
        "display_name": "DeepSeek",
        "modalities": ["language"],
        "docs_url": None,
        "env_configured": False,
    },
]


def credential(id, name, provider, count):
    return dict(
        id=id,
        name=name,
        provider=provider,
        modalities=["language"],
        base_url=None,
        endpoint=None,
        endpoint_llm=None,
        endpoint_embedding=None,
        endpoint_stt=None,
        endpoint_tts=None,
        credentials_path=None,
        project=None,
        location=None,
        api_version=None,
        num_ctx=None,
        has_api_key=True,
        model_count=count,
        decryption_error=None,
        created="2026-11-10",
        updated="2026-11-10",
    )


NEW = credential(
    "credential:deepseek-new", "DeepSeek 新配置 · 已保存待注册", "deepseek", 0
)
OLD = credential(
    "credential:deepseek-old", "DeepSeek 旧配置 · 仍与已注册模型关联", "deepseek", 1
)
OPENAI = credential("credential:openai", "OpenAI 原有聊天配置", "openai", 1)
CHAT = dict(
    id="model:openai",
    name="OpenAI 原有聊天模型",
    provider="openai",
    type="language",
    credential=OPENAI["id"],
    created="2026-11-10",
    updated="2026-11-10",
)
DEEP = dict(
    id="model:deepseek",
    name="DeepSeek 文献阅读与控制系统反馈分析模型",
    provider="deepseek",
    type="language",
    credential=OLD["id"],
    created="2026-11-10",
    updated="2026-11-10",
)


def state_for(scenario):
    if scenario in ("empty", "encryption_blocker"):
        return {"credentials": [], "models": [], "defaults": copy.deepcopy(DEFAULTS)}
    if scenario == "saved_unregistered":
        return {"credentials": [NEW], "models": [], "defaults": copy.deepcopy(DEFAULTS)}
    if scenario == "multiple_pending":
        return {
            "credentials": [
                NEW,
                {
                    **NEW,
                    "id": "credential:openai-new",
                    "name": "OpenAI 新配置 · 已保存待注册",
                    "provider": "openai",
                },
            ],
            "models": [],
            "defaults": copy.deepcopy(DEFAULTS),
        }
    if scenario == "dangling_model":
        return {
            "credentials": [],
            "models": [{**CHAT, "credential": "credential:missing"}],
            "defaults": {**DEFAULTS, "default_chat_model": CHAT["id"]},
        }
    if scenario == "embedding_only":
        return {
            "credentials": [{**OPENAI, "modalities": ["language", "embedding"]}],
            "models": [{**CHAT, "type": "embedding", "name": "OpenAI 资料检索模型"}],
            "defaults": {**DEFAULTS, "default_embedding_model": CHAT["id"]},
        }
    if scenario == "environment_model":
        return {
            "credentials": [],
            "models": [{**CHAT, "credential": None}],
            "defaults": {**DEFAULTS, "default_chat_model": CHAT["id"]},
        }
    if scenario == "registered_not_default":
        return {
            "credentials": [{**NEW, "model_count": 1}],
            "models": [{**DEEP, "credential": NEW["id"]}],
            "defaults": copy.deepcopy(DEFAULTS),
        }
    return {
        "credentials": [OPENAI, OLD, NEW],
        "models": [CHAT, DEEP],
        "defaults": {**DEFAULTS, "default_chat_model": CHAT["id"]},
    }


def failure(tag, detail):
    report["failures"].append({"case": tag, "detail": str(detail)})


def active(page):
    return page.evaluate(
        """() => {const e=document.activeElement,r=e.getBoundingClientRect(),s=getComputedStyle(e);return {tag:e.tagName,id:e.id,label:e.getAttribute('aria-label')||e.textContent.trim(),outline:s.outlineStyle,outlineWidth:s.outlineWidth,visibleFocus:e.matches(':focus-visible'),x:r.x,y:r.y,width:r.width,height:r.height}}"""
    )


def tab_to(page, label, limit=100):
    for _ in range(limit):
        page.keyboard.press("Tab")
        if active(page)["label"] == label:
            return active(page)
    raise AssertionError("Keyboard target not reached: " + label)


def fonts(page):
    page.add_style_tag(
        content="@font-face{font-family:QA;src:url('/qa-font.ttf')}@font-face{font-family:QAChinese;src:url('/qa-chinese.ttf')}*{font-family:QA,QAChinese,sans-serif!important}h1,h2,h3{font-family:QAChinese!important}"
    )
    page.evaluate("document.fonts.ready")


def capture(page, tag, scenario, width, theme, text_scale=1):
    page.evaluate("window.scrollTo(0,0)")
    full = OUT / (tag + "-full.png")
    guide = OUT / (tag + "-guide.png")
    page.screenshot(path=str(full), full_page=True)
    viewport = OUT / (tag + "-viewport.png")
    page.screenshot(path=str(viewport), full_page=False)
    guide_height = (
        None
        if BASELINE
        else page.locator(".model-setup-guide").bounding_box()["height"]
    )
    # Firefox can mispaint fixed offscreen content in a locator screenshot taller than the viewport.
    guide_safe = (
        guide_height is not None and guide_height <= page.viewport_size["height"]
    )
    if guide_safe:
        page.locator(".model-setup-guide").screenshot(path=str(guide))
    metrics = page.evaluate("""() => ({width:innerWidth,documentWidth:document.documentElement.scrollWidth,overflow:document.documentElement.scrollWidth>innerWidth,
        theme:document.documentElement.dataset.theme,language:document.documentElement.lang,
        skipLink:(()=>{const e=document.querySelector('.skip-link'),r=e.getBoundingClientRect();return {focused:e===document.activeElement,top:r.y,bottom:r.bottom,styleTop:getComputedStyle(e).top}})(),
        outliers:[...document.querySelectorAll('header button,header a,main button,main select,main input,main .model-setup-guide')].filter(e=>{const r=e.getBoundingClientRect();return r.width&& (r.x < -1 || r.right>innerWidth+1)}).map(e=>({tag:e.tagName,text:(e.getAttribute('aria-label')||e.textContent).slice(0,90),width:e.getBoundingClientRect().width}))})""")
    row = {
        "tag": tag,
        "scenario": scenario,
        "width": width,
        "theme": theme,
        "text_scale": text_scale,
        "full_screenshot": str(full.relative_to(ROOT)),
        "viewport_screenshot": str(viewport.relative_to(ROOT)),
        "guide_height": guide_height,
        "guide_screenshot": str(guide.relative_to(ROOT)) if guide_safe else None,
        "guide_clip_note": None
        if guide_safe or BASELINE
        else "Use full/viewport screenshot: oversized locator capture can mispaint offscreen fixed elements in Firefox",
        **metrics,
    }
    report["results"].append(row)
    if metrics["overflow"] or metrics["outliers"]:
        failure(tag, metrics)
    if metrics["theme"] != theme or metrics["language"] != "zh-CN":
        failure(tag, "Theme/language not applied")
    print(tag, "overflow=" + str(metrics["overflow"]), flush=True)


def check_navigation(page, tag, scenario):
    next_link = page.locator(".model-setup-guide .dialog-actions a").first
    label = next_link.inner_text()
    href = next_link.get_attribute("href")
    expected = (
        "添加聊天模型配置"
        if scenario == "empty"
        else "查看待注册配置"
        if scenario == "multiple_pending"
        else "选择聊天默认模型"
        if scenario in ("registered_not_default", "environment_model")
        else "查看配置状态"
        if scenario
        in ("metadata_failure", "unknown_write", "dangling_model", "encryption_blocker")
        else "注册模型：OpenAI · " + OPENAI["name"]
        if scenario == "embedding_only"
        else "注册模型：DeepSeek · " + NEW["name"]
    )
    assert label == expected, (scenario, label, expected)
    assert href.startswith("#")
    target = page.locator('[id="' + href[1:] + '"]')
    before = len([n for n in report["network"] if n["method"] != "GET"])
    next_link.focus()
    page.keyboard.press("Enter")
    expect(target).to_be_focused()
    if scenario == "multiple_pending":
        assert target.get_by_role("link").count() == 2
    if expected.startswith("注册模型："):
        expect(
            target.get_by_role(
                "button",
                name="发现模型 "
                + (OPENAI["name"] if scenario == "embedding_only" else NEW["name"]),
                exact=True,
            )
        ).to_be_visible()
    assert len([n for n in report["network"] if n["method"] != "GET"]) == before
    page.screenshot(path=str(OUT / (tag + "-primary-target.png")), full_page=False)
    return {"label": label, "href": href, "target_focus": True, "automatic_non_get": 0}


def enlarge_text(page):
    before = page.locator(".model-setup-guide dt").first.evaluate(
        "e=>getComputedStyle(e).fontSize"
    )
    page.evaluate(
        """() => {const list=[...document.querySelectorAll('body *')].map(e=>[e,parseFloat(getComputedStyle(e).fontSize)]);for(const [e,n] of list)e.style.fontSize=(n*2)+'px'}"""
    )
    after = page.locator(".model-setup-guide dt").first.evaluate(
        "e=>getComputedStyle(e).fontSize"
    )
    assert float(after.removesuffix("px")) == float(before.removesuffix("px")) * 2
    return {
        "method": "Every element's pre-enlargement computed font size doubled independently",
        "before": before,
        "after": after,
    }


def _owned_directory(path):
    info = path.lstat()
    if (
        not stat.S_ISDIR(info.st_mode)
        or info.st_uid != os.getuid()
        or info.st_mode & 0o022
    ):
        raise ValueError(
            f"QA directory must be owned, non-symlink and not group/world writable: {path}"
        )


@contextmanager
def review_workspace(root, run):
    """Keep reports; remove only this run's random private scratch.

    Custody assumes root ancestors cannot be renamed by other users and no
    malicious same-UID process races these checks. This is not a universal
    race-resistant filesystem sandbox.

    QA_RUN is a new identifier, never a path. Existing runs are immutable: choose
    a new QA_RUN (for example matrix-20261114-2) rather than overwriting evidence.
    """
    if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", run) is None:
        raise ValueError(
            "QA_RUN must be a 1-64 character alphanumeric/dash/underscore identifier"
        )
    root = Path(root).absolute()
    if any(path.is_symlink() for path in (root, *root.parents)):
        raise ValueError("QA root must not have symlink ancestors")
    _owned_directory(root)
    parent = root
    for name in (".superpowers", "sdd", "2026-11-10-model-setup-journey", "visual-qa"):
        parent = parent / name
        try:
            parent.mkdir(mode=0o700)
        except FileExistsError:
            pass
        _owned_directory(parent)
    out = parent / run
    out.mkdir(mode=0o700)  # Atomic refusal of any existing file/directory/symlink.
    _owned_directory(out)
    with tempfile.TemporaryDirectory(prefix=".scratch-", dir=parent) as temporary:
        yield out, Path(temporary)


def child_environment(scratch):
    # Explicit QA inputs only: never inherit provider credentials, proxy settings,
    # loader hooks, Node flags, Git overrides or the user's home configuration.
    env = {
        key: os.environ[key]
        for key in (
            "QA_BASELINE",
            "QA_PORT",
            "QA_WIDTHS",
            "QA_THEMES",
            "QA_SCENARIOS",
            "QA_KEYBOARD",
        )
        if key in os.environ
    }
    env.update(
        {
            "HOME": str(scratch / "home"),
            "TMPDIR": str(scratch / "tmp"),
            "XDG_CACHE_HOME": str(scratch / "cache"),
            "XDG_CONFIG_HOME": str(scratch / "home/.config"),
            "LANG": "C.UTF-8",
            "LC_ALL": "C.UTF-8",
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": "/dev/null",
            "PLAYWRIGHT_BROWSERS_PATH": str(TOOLS / "cache/browsers"),
            "PATH": str(TOOLS / "tools/node-v24.19.0-linux-x64/bin") + ":/usr/bin:/bin",
        }
    )
    return env


def review_environment(scratch):
    for name in ("home", "tmp", "cache"):
        (scratch / name).mkdir(mode=0o700)
    return child_environment(scratch)


def stop_preview(server):
    if server.poll() is None:
        os.killpg(server.pid, signal.SIGTERM)
        try:
            server.wait(timeout=15)
        except subprocess.TimeoutExpired:
            os.killpg(server.pid, signal.SIGKILL)
            # Do not remove scratch while an owned child could still use it.
            server.wait()


def run_review(out, scratch):
    global OUT, SOURCE, APP, report, expect, sync_playwright
    from playwright.sync_api import expect, sync_playwright

    OUT, SOURCE, APP = out, ROOT, ROOT / "apps/web"
    if BASELINE:
        SOURCE = scratch / "baseline-source"
        SOURCE.mkdir(parents=True, exist_ok=True)
        if not (SOURCE / "apps/web/src/features/settings/ModelsPage.tsx").exists():
            archive = subprocess.Popen(
                [
                    "git",
                    "archive",
                    "9ee810",
                    "apps/web",
                    "packages",
                    "frontend/src/lib/locales",
                    "package.json",
                    "package-lock.json",
                    "tsconfig.base.json",
                ],
                cwd=ROOT,
                stdout=subprocess.PIPE,
            )
            subprocess.run(
                ["tar", "-xf", "-", "-C", str(SOURCE)], stdin=archive.stdout, check=True
            )
            archive.stdout.close()
            assert archive.wait() == 0
        if not (SOURCE / "tsconfig.base.json").exists():
            (SOURCE / "tsconfig.base.json").write_bytes(
                subprocess.check_output(
                    ["git", "show", "9ee810:tsconfig.base.json"], cwd=ROOT
                )
            )
        for relative in ("node_modules", "apps/web/node_modules"):
            target = SOURCE / relative
            if not target.exists() and (ROOT / relative).exists():
                target.symlink_to(ROOT / relative, target_is_directory=True)
        APP = SOURCE / "apps/web"
        # Tooling-only baseline cache isolation; original product sources remain from 9ee810.
        config = (
            (APP / "vite.config.ts")
            .read_text()
            .replace(
                "defineConfig({ envDir:false,",
                "defineConfig({ cacheDir:"
                + json.dumps(str(scratch / "cache/vite"))
                + ", envDir:false,",
            )
        )
        (APP / "vite.review.config.ts").write_text(config)

    report = {
        "baseline": BASELINE,
        "source_root": str(SOURCE),
        "boundary": "Private loopback Vite source preview and disposable Firefox contexts. All API/config/manifest responses synthetic; every HTTP URL is audited and other origins blocked. No provider, live 18770, user profile or credential reads.",
        "started_utc": datetime.now(timezone.utc).isoformat(),
        "base": BASE,
        "source_files": {},
        "results": [],
        "network": [],
        "websockets": [],
        "page_errors": [],
        "console_errors": [],
        "failures": [],
        "not_run": [
            "Real provider calls and persistence",
            "Actual mobile hardware/soft keyboard",
            "Native browser zoom (200% computed text enlargement checked instead)",
        ],
    }
    for relative in (
        "apps/web/src/features/settings/ModelsPage.tsx",
        "apps/web/src/features/settings/ModelSetupGuide.tsx",
        "apps/web/src/features/settings/ModelSetupGuide.css",
        "apps/web/src/i18n/model-setup-messages.ts",
    ):
        p = SOURCE / relative
        if not p.exists():
            continue
        report["source_files"][relative] = {
            "sha256": hashlib.sha256(p.read_bytes()).hexdigest(),
            "mtime_utc": datetime.fromtimestamp(
                p.stat().st_mtime, timezone.utc
            ).isoformat(),
        }
    (OUT / "review-script.py").write_bytes(Path(__file__).read_bytes())
    report["review_script_sha256"] = hashlib.sha256(
        Path(__file__).read_bytes()
    ).hexdigest()
    report["head"] = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
    ).strip()
    # Fail closed if the requested port is occupied. Vite's strictPort also covers the release/bind race.
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", PORT))
    env = child_environment(scratch)
    env["SPA_ARTIFACT_IDENTITY"] = json.dumps(
        {**IDENTITY, "release_slot": "synthetic-model-setup-review"}
    )
    server_log = (OUT / "vite.log").open("w")
    server = subprocess.Popen(
        [
            str(ROOT / "node_modules/.bin/vite"),
            "--host",
            "127.0.0.1",
            "--port",
            str(PORT),
            "--strictPort",
            "--base",
            "/",
            *(["--config", str(APP / "vite.review.config.ts")] if BASELINE else []),
        ],
        cwd=APP,
        env=env,
        start_new_session=True,
        stdout=server_log,
        stderr=subprocess.STDOUT,
    )

    try:
        for _ in range(60):
            if server.poll() is not None:
                raise RuntimeError("Private Vite exited during startup")
            with socket.socket() as probe:
                if probe.connect_ex(("127.0.0.1", PORT)) == 0:
                    break
            time.sleep(0.2)
        else:
            raise RuntimeError("Private Vite did not bind")
        with sync_playwright() as playwright:
            browser = playwright.firefox.launch(headless=True, env=env)
            report["browser"] = browser.version
            widths = [
                int(v)
                for v in os.environ.get("QA_WIDTHS", "390,768,1024,1440").split(",")
            ]
            themes = os.environ.get("QA_THEMES", "light,dark").split(",")
            scenarios = os.environ.get(
                "QA_SCENARIOS",
                "empty,saved_unregistered,registered_not_default,old_default,rate_limit_receipt,metadata_failure,unknown_write",
            ).split(",")
            for width in widths:
                for theme in themes:
                    current = {
                        "scenario": "empty",
                        "tag": "",
                        "data": state_for("empty"),
                    }
                    context = browser.new_context(
                        viewport={
                            "width": width,
                            "height": 1000 if width >= 1024 else 844,
                        },
                        locale="zh-CN",
                        color_scheme=theme,
                        service_workers="block",
                    )

                    def intercept(route):
                        req = route.request
                        u = urlparse(req.url)
                        entry = {
                            "case": current["tag"],
                            "url": req.url,
                            "method": req.method,
                            "explicit_action": current.get("action"),
                        }
                        if req.method != "GET" and not current.get("action"):
                            failure(
                                current["tag"], "Unexpected automatic non-GET request"
                            )
                        report["network"].append(entry)
                        if (
                            u.scheme not in ("http", "https")
                            or u.netloc != f"127.0.0.1:{PORT}"
                        ):
                            entry["decision"] = "blocked_other_origin"
                            route.abort()
                            return
                        path = unquote(u.path)
                        if path in ("/qa-font.ttf", "/qa-chinese.ttf"):
                            entry["decision"] = "synthetic_local_font"
                            route.fulfill(
                                path=str(
                                    FONTS
                                    / (
                                        "arial.ttf"
                                        if path == "/qa-font.ttf"
                                        else "qa-chinese.ttf"
                                    )
                                ),
                                content_type="font/ttf",
                            )
                            return
                        if path.endswith("/spa-artifact-manifest.json"):
                            value = IDENTITY
                        elif path == "/config":
                            value = {
                                "apiUrl": "",
                                "auth_mode": "legacy_password",
                                "web_session_protocol": None,
                                "client_contracts": ["workspace-view-v1"],
                                "ui_transport_protocol": 1,
                            }
                        elif path == "/api/auth/status":
                            value = {"auth_enabled": False}
                        elif path == "/api/personal/client-capabilities":
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
                        elif path == "/api/credentials/status":
                            value = {
                                "configured": {},
                                "source": {},
                                "encryption_configured": current["scenario"]
                                not in ("encryption_blocker", "environment_model"),
                            }
                        elif path == "/api/credentials/env-status":
                            value = {}
                        elif path == "/api/providers":
                            value = PROVIDERS
                        elif path == "/api/credentials":
                            value = current["data"]["credentials"]
                        elif path == "/api/models":
                            if current["scenario"] == "metadata_failure":
                                entry["decision"] = "synthetic_api_503"
                                route.fulfill(
                                    status=503,
                                    json={"detail": "Synthetic metadata failure"},
                                )
                                return
                            value = current["data"]["models"]
                        elif path == "/api/models/defaults":
                            if req.method == "PUT":
                                assert current["scenario"] == "unknown_write"
                                entry["decision"] = "synthetic_uncertain_write"
                                route.fulfill(
                                    status=503,
                                    json={"detail": "Synthetic unknown receipt"},
                                )
                                return
                            value = current["data"]["defaults"]
                        elif (
                            path == "/api/models/model:deepseek/test"
                            and req.method == "POST"
                        ):
                            assert current["scenario"] == "rate_limit_receipt"
                            value = {
                                "success": True,
                                "message": "Rate limited - but connection works",
                                "details": "synthetic-private-response-details",
                            }
                        elif path.startswith("/api/"):
                            entry["decision"] = "unexpected_api_blocked"
                            failure(current["tag"], "Unexpected API: " + path)
                            route.fulfill(
                                status=404,
                                json={"detail": "Unregistered synthetic route"},
                            )
                            return
                        else:
                            if req.method != "GET":
                                raise AssertionError("Unexpected local asset write")
                            entry["decision"] = "local_vite_asset"
                            route.continue_()
                            return
                        entry["decision"] = "synthetic_api"
                        route.fulfill(status=200, json=value)

                    context.route("**/*", intercept)
                    page = context.new_page()
                    page.set_default_timeout(15000)
                    page.on(
                        "pageerror",
                        lambda error: report["page_errors"].append(
                            {"case": current["tag"], "error": str(error)}
                        ),
                    )
                    page.on(
                        "console",
                        lambda message: report["console_errors"].append(
                            {"case": current["tag"], "error": message.text}
                        )
                        if message.type == "error"
                        else None,
                    )
                    page.on(
                        "websocket",
                        lambda ws: report["websockets"].append(
                            {
                                "case": current["tag"],
                                "url": urlparse(ws.url)._replace(query="").geturl(),
                                "local": urlparse(ws.url).netloc == f"127.0.0.1:{PORT}",
                            }
                        ),
                    )
                    for scenario in scenarios:
                        tag = f"{width}-{theme}-{scenario}"
                        current.update(
                            scenario=scenario,
                            tag=tag,
                            data=state_for(scenario),
                            action=None,
                        )
                        try:
                            page.goto(
                                BASE + "/settings/models?qa=" + scenario,
                                wait_until="domcontentloaded",
                                timeout=60000,
                            )
                            if not BASELINE:
                                expect(
                                    page.get_by_role(
                                        "region", name="模型配置进度", exact=True
                                    )
                                ).to_be_visible()
                            if scenario == "metadata_failure":
                                expect(
                                    page.get_by_text("无法加载: 已注册模型", exact=True)
                                ).to_be_visible()
                            else:
                                expect(
                                    page.get_by_role(
                                        "button", name="自动分配默认值", exact=True
                                    )
                                ).to_be_enabled()
                            fonts(page)
                            if scenario == "rate_limit_receipt":
                                page.get_by_role(
                                    "button",
                                    name="测试模型 " + DEEP["name"],
                                    exact=True,
                                ).click()
                                current["action"] = (
                                    "User confirmation of synthetic " + scenario
                                )
                                page.get_by_role("dialog").get_by_role(
                                    "button", name="确认操作", exact=True
                                ).click()
                                expect(
                                    page.get_by_role("dialog").get_by_role(
                                        "heading", name="已收到检查结果", exact=True
                                    )
                                ).to_be_visible()
                                expect(
                                    page.get_by_role("dialog").get_by_text(
                                        "肯定的检查回执可能只确认连通性", exact=False
                                    )
                                ).to_be_visible()
                                modal = OUT / (tag + "-modal.png")
                                page.screenshot(path=str(modal), full_page=False)
                                report["results"].append(
                                    {
                                        "tag": tag + "-modal",
                                        "scenario": scenario,
                                        "width": width,
                                        "theme": theme,
                                        "screenshot": str(modal.relative_to(ROOT)),
                                        "kind": "result_dialog",
                                    }
                                )
                                page.get_by_role("dialog").get_by_role(
                                    "button", name="关闭", exact=True
                                ).click()
                                expect(
                                    page.locator(".model-setup-guide")
                                ).to_contain_text("模型实际响应尚未确认")
                                assert (
                                    "synthetic-private-response-details"
                                    not in page.locator("body").inner_text()
                                )
                            if scenario == "unknown_write":
                                page.get_by_role(
                                    "combobox", name="聊天模型", exact=True
                                ).select_option(DEEP["id"])
                                current["action"] = (
                                    "User confirmation of synthetic " + scenario
                                )
                                page.get_by_role("dialog").get_by_role(
                                    "button", name="确认操作", exact=True
                                ).click()
                                expect(
                                    page.get_by_role(
                                        "button", name="自动分配默认值", exact=True
                                    )
                                ).to_be_disabled()
                                expect(
                                    page.locator(".model-setup-guide dt")
                                    .filter(has_text="当前全局聊天默认模型")
                                    .locator("..")
                                ).to_contain_text("未知")
                            capture(page, tag, scenario, width, theme)
                            if not BASELINE:
                                report["results"][-1]["primary_navigation"] = (
                                    check_navigation(page, tag, scenario)
                                )
                            if scenario == "old_default" and not BASELINE:
                                page.locator("#registered-models").screenshot(
                                    path=str(OUT / (tag + "-bindings.png"))
                                )
                            if scenario == "saved_unregistered":
                                page.locator("article").first.screenshot(
                                    path=str(OUT / (tag + "-next-step.png"))
                                )
                            if (
                                not BASELINE
                                and scenario == "old_default"
                                and (width, theme) in ((390, "light"), (1440, "dark"))
                            ):
                                metrics = enlarge_text(page)
                                capture(
                                    page, tag + "-text-200", scenario, width, theme, 2
                                )
                                report["results"][-1]["enlargement"] = metrics
                        except Exception as exc:
                            failure(tag, repr(exc))
                            page.screenshot(
                                path=str(OUT / (tag + "-FAIL.png")), full_page=True
                            )
                    # Keyboard route/confirm/cancel in a fresh, ordinary-size page. No provider check is sent.
                    if (
                        not BASELINE
                        and width in (390, 1440)
                        and os.environ.get("QA_KEYBOARD", "1") == "1"
                    ):
                        tag = f"{width}-{theme}-keyboard"
                        current.update(
                            scenario="old_default",
                            tag=tag,
                            data=state_for("old_default"),
                            action=None,
                        )
                        try:
                            page.goto(
                                BASE + "/settings/models?qa=keyboard",
                                wait_until="domcontentloaded",
                            )
                            expect(
                                page.get_by_role(
                                    "button", name="自动分配默认值", exact=True
                                )
                            ).to_be_enabled()
                            fonts(page)
                            tab_to(page, "如何判断配置生效")
                            page.keyboard.press("Enter")
                            expect(
                                page.locator(".model-setup-guide details")
                            ).to_have_attribute("open", "")
                            page.screenshot(
                                path=str(OUT / (tag + "-explanation.png")),
                                full_page=False,
                            )
                            page.keyboard.press("Enter")
                            expect(
                                page.locator(".model-setup-guide details")
                            ).not_to_have_attribute("open", "")
                            page.keyboard.press("Shift+Tab")
                            page.keyboard.press("Shift+Tab")
                            focus = active(page)
                            assert (
                                focus["label"] == "注册模型：DeepSeek · " + NEW["name"]
                            )
                            anchor_focus = focus
                            assert (
                                focus["visibleFocus"]
                                and float(focus["outlineWidth"].removesuffix("px")) >= 2
                            )
                            page.screenshot(
                                path=str(OUT / (tag + "-guide-focus.png")),
                                full_page=False,
                            )
                            page.keyboard.press("Enter")
                            expect(
                                page.get_by_role(
                                    "heading", name=NEW["name"], exact=True
                                ).locator("..")
                            ).to_be_focused()
                            page.keyboard.press("Tab")
                            expect(
                                page.get_by_role(
                                    "heading", name=NEW["name"], exact=True
                                )
                                .locator("..")
                                .get_by_role(
                                    "button", name="编辑 " + NEW["name"], exact=True
                                )
                            ).to_be_focused()
                            focus = tab_to(page, "测试模型 " + DEEP["name"])
                            page.keyboard.press("Enter")
                            expect(page.get_by_role("dialog")).to_be_visible()
                            page.screenshot(
                                path=str(OUT / (tag + "-confirmation.png")),
                                full_page=False,
                            )
                            page.keyboard.press("Escape")
                            expect(page.get_by_role("dialog")).not_to_be_visible()
                            restored = active(page)
                            if restored["label"] != "测试模型 " + DEEP["name"]:
                                failure(
                                    tag,
                                    "Dialog focus did not return: "
                                    + json.dumps(restored, ensure_ascii=False),
                                )
                            assert not any(
                                n["case"] == tag and n["method"] != "GET"
                                for n in report["network"]
                            )
                            report["results"].append(
                                {
                                    "tag": tag,
                                    "width": width,
                                    "theme": theme,
                                    "kind": "keyboard",
                                    "anchor_focus": anchor_focus,
                                    "explanation_keyboard_toggle": True,
                                    "restored_focus": restored,
                                }
                            )
                        except Exception as exc:
                            failure(tag, repr(exc))
                    context.close()
            browser.close()
    finally:
        # Only the process group created by this script is stopped.
        stop_preview(server)
        server_log.close()
        report["preview_pid"] = server.pid
        report["preview_stopped"] = server.poll() is not None
        report["finished_utc"] = datetime.now(timezone.utc).isoformat()
        report["screenshots"] = [
            {
                "path": str(p.relative_to(ROOT)),
                "sha256": hashlib.sha256(p.read_bytes()).hexdigest(),
            }
            for p in sorted(OUT.glob("*.png"))
        ]
        report["source_unchanged"] = all(
            hashlib.sha256((SOURCE / path).read_bytes()).hexdigest() == entry["sha256"]
            for path, entry in report["source_files"].items()
        )
        report["counts"] = {
            "cases": len(report["results"]),
            "network": len(report["network"]),
            "page_errors": len(report["page_errors"]),
            "failures": len(report["failures"]),
            "other_origin_requests": sum(
                r["decision"] == "blocked_other_origin" for r in report["network"]
            ),
            "synthetic_non_get": sum(r["method"] != "GET" for r in report["network"]),
        }
        (OUT / "screenshot-manifest.json").write_text(
            json.dumps(report["screenshots"], ensure_ascii=False, indent=2)
        )
        (OUT / "report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2)
        )
        print(json.dumps(report["counts"]), flush=True)
        print(OUT, flush=True)
    if (
        report["failures"]
        or report["page_errors"]
        or any(not w["local"] for w in report["websockets"])
    ):
        raise SystemExit(1)


def _terminate_review(signum, frame):
    raise SystemExit(128 + signum)


def main():
    previous = signal.signal(signal.SIGTERM, _terminate_review)
    try:
        with review_workspace(ROOT, os.environ.get("QA_RUN", "matrix")) as (
            out,
            scratch,
        ):
            env = review_environment(scratch)
            # Isolate Playwright's driver as well as browser/Vite children without
            # mutating the caller's environment. Reports stay at the stable out path.
            child = subprocess.Popen(
                [
                    sys.executable,
                    str(Path(__file__).resolve()),
                    "--_review",
                    str(out),
                    str(scratch),
                ],
                env=env,
                cwd=ROOT,
            )
            try:
                return child.wait()
            finally:
                if child.poll() is None:
                    child.terminate()
                    # The child handles SIGTERM and stops Vite before exiting.
                    child.wait()
    finally:
        signal.signal(signal.SIGTERM, previous)


def child_main(out, scratch):
    parent = ROOT / ".superpowers/sdd/2026-11-10-model-setup-journey/visual-qa"
    for path in (out, scratch):
        if path.parent != parent or any(p.is_symlink() for p in (path, *path.parents)):
            raise ValueError(
                "Review child paths must be owned direct children of the report parent"
            )
        _owned_directory(path)
    if not scratch.name.startswith(".scratch-") or scratch == out:
        raise ValueError("Invalid private scratch directory")
    if os.environ.get("TMPDIR") != str(scratch / "tmp") or os.environ.get(
        "XDG_CACHE_HOME"
    ) != str(scratch / "cache"):
        raise ValueError("Review child environment does not match scratch")
    for name in ("tmp", "cache"):
        _owned_directory(scratch / name)
    previous = signal.signal(signal.SIGTERM, _terminate_review)
    try:
        run_review(out, scratch)
    finally:
        signal.signal(signal.SIGTERM, previous)


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "--_review":
        child_main(Path(sys.argv[2]), Path(sys.argv[3]))
    else:
        raise SystemExit(main())

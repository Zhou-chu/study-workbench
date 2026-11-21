"""Use disposable disk paths to check local Chromium discovery; launch no browser."""


class TestCrawl4aiLocalReadiness:
    """Local Crawl4AI needs the package AND a Chromium browser on disk."""

    def test_not_ready_when_browser_missing(self, monkeypatch, tmp_path):
        import open_notebook.utils.runtime_capabilities as cap

        monkeypatch.setattr(
            cap.importlib.util, "find_spec", lambda name, *a, **k: object()
        )
        # PLAYWRIGHT_BROWSERS_PATH set to an empty dir → no chromium installed.
        monkeypatch.setenv("PLAYWRIGHT_BROWSERS_PATH", str(tmp_path))
        assert cap.crawl4ai_local_ready() is False

    def test_ready_when_browser_present(self, monkeypatch, tmp_path):
        import open_notebook.utils.runtime_capabilities as cap

        monkeypatch.setattr(
            cap.importlib.util, "find_spec", lambda name, *a, **k: object()
        )
        (tmp_path / "chromium-1140").mkdir()
        monkeypatch.setenv("PLAYWRIGHT_BROWSERS_PATH", str(tmp_path))
        assert cap.crawl4ai_local_ready() is True

    def test_dev_default_cache_without_browser_is_not_ready(
        self, monkeypatch, tmp_path
    ):
        """No PLAYWRIGHT_BROWSERS_PATH: fall back to the default cache, fail closed if empty."""
        import open_notebook.utils.runtime_capabilities as cap

        monkeypatch.setattr(
            cap.importlib.util, "find_spec", lambda name, *a, **k: object()
        )
        monkeypatch.delenv("PLAYWRIGHT_BROWSERS_PATH", raising=False)
        monkeypatch.setattr(cap, "_default_playwright_cache", lambda: str(tmp_path))
        assert cap.crawl4ai_local_ready() is False

    def test_dev_default_cache_with_browser_is_ready(self, monkeypatch, tmp_path):
        import open_notebook.utils.runtime_capabilities as cap

        monkeypatch.setattr(
            cap.importlib.util, "find_spec", lambda name, *a, **k: object()
        )
        monkeypatch.delenv("PLAYWRIGHT_BROWSERS_PATH", raising=False)
        (tmp_path / "chromium-1140").mkdir()
        monkeypatch.setattr(cap, "_default_playwright_cache", lambda: str(tmp_path))
        assert cap.crawl4ai_local_ready() is True

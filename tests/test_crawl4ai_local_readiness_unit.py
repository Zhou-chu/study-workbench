"""Check the isolated early return when the optional package is absent."""


class TestCrawl4aiLocalReadiness:
    def test_not_ready_when_package_missing(self, monkeypatch):
        import open_notebook.utils.runtime_capabilities as cap

        monkeypatch.setattr(cap.importlib.util, "find_spec", lambda name, *a, **k: None)
        assert cap.crawl4ai_local_ready() is False

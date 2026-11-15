"""Filesystem documentation contract, not strict unit or visual acceptance."""

import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_shared_ui_document_keeps_exact_approved_bytes() -> None:
    canonical = (ROOT / "UIdesign.md").read_bytes()
    compatibility = (ROOT / "docs/design/shared-ui.md").read_bytes()
    assert canonical == compatibility
    assert hashlib.sha256(canonical).hexdigest() == (
        "03be3db35fc583ce7fa3a4d13d046aa970c240da3c9602d1d10cfa33792125ad"
    )


def test_product_and_status_docs_link_canonical_without_claiming_acceptance() -> None:
    design = (ROOT / "DESIGN.md").read_text()
    status = (ROOT / "docs/v1/CURRENT_STATUS.md").read_text()
    assert "[UIdesign.md](UIdesign.md)" in design
    assert "共同规范第 5 节" in design
    assert "../../UIdesign.md" in status
    assert "SPA_ROUTE_COVERAGE.md" in status
    assert "SPA_BROWSER_CASES.json" in status
    assert "完整严格单元 >90% 和全量 Sonar 验收仍未闭合" in status

"""Pure reciprocal-rank fusion behavior; no repository or filesystem fixture."""

import importlib


def test_rrf_one_based_deduplicated_stable_top_48_and_limits():
    rrf = importlib.import_module("api.evidence_retrieval").rrf
    assert rrf(["a"], ["a"])[0] == ("a", 2 / 61)
    assert rrf(["b", "a"], ["a", "b"]) == [
        ("a", 1 / 61 + 1 / 62),
        ("b", 1 / 61 + 1 / 62),
    ]
    assert rrf(["a", "a", "b"], ["b"]) == [("b", 1 / 61 + 1 / 62), ("a", 1 / 61)]
    assert rrf([], []) == []
    assert len(rrf([f"a{i:03d}" for i in range(100)], [])) == 12
    result = rrf(
        [f"a{i:03d}" for i in range(100)], [f"b{i:03d}" for i in range(100)], limit=100
    )
    assert len(result) == 96
    assert not any(identity.endswith("048") for identity, _ in result)

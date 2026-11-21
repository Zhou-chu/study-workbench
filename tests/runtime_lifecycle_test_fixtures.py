"""Load the real owned-process lifecycle helper for offline local tests."""

import importlib.util


def lifecycle():
    assert importlib.util.find_spec("scripts.v1.runtime_lifecycle"), (
        "shared lifecycle missing"
    )
    return importlib.import_module("scripts.v1.runtime_lifecycle")

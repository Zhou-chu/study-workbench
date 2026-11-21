# Content detection classification

The three existing detection classes (21 cases) move unchanged to
`tests/test_chunking_detection_unit.py`. They call real extension, heuristic and
combined-selection functions with literal text. They do not tokenize, read files,
launch a browser or use a provider. All class ASTs and all retained helper and
chunk-test ASTs compare equal before and after extraction.

The remaining 13 cases retain real tokenizer and splitter collaboration,
including tokenizer-resource loading, and are not counted as pure units. The
original combined file passed 34 cases; the two final files also pass all 34.
An intermediate split omitted the retained ContentType import; Ruff caught it
and eight integration cases failed. The import was restored before final
verification. Ruff and formatting checks now pass without weakening assertions.

This is classification of existing behavior, not 21 new regression cases or
proof of source ingestion, embedding publication or browser acceptance. No
production implementation or full coverage denominator was changed.

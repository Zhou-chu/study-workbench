# Text regex reliability review

Baseline 588aaf5. Isolated candidate, no real data or runtime changes.

## Evidence paragraphs: no production change

Ten direct-unit checks of the original implementation passed in 0.23 seconds,
including exhaustive short strings against the original regex oracle, Unicode
whitespace/CRLF, original offsets, positive chunk limits, and a long nonseparator
whitespace run. This did not reproduce superlinear behavior and is not proof of
general safety. Notably `a\n\nb` remains one span because the optional group
tries to reach a second nonspace before considering the singleton alternative.
A naive blank-line splitter would change the existing citation contract.
Keep the Sonar finding unresolved pending stronger complexity review.

## UX recovery observer: reproduced pathological scan

Two original-code tests yielded one pass and one failure in 4.56 seconds.
A roughly 60 KB synthetic multipart body with 12000 potential header endings but
no payload terminator consumed 4.521 CPU seconds. The two lazy wildcard regions
revisited suffixes for every possible header ending.

The candidate recognizes the original file-header grammar, then searches each
separator once using `str.find`, retaining original payload slicing and failure
messages. No body-size limit, input truncation or quote normalization was added.
The observer is a controlled-fixture test utility, not a general RFC multipart
parser. Existing restrictions and delimiter-like content semantics are preserved.

Tests compile the exact nested production observer function from its source AST,
with only its route I/O and enclosing result lists supplied in memory. They do
not import or launch browser/runtime code. Static source reads are the only file
access in these unit tests. Coverage instrumentation is not measured in this batch.

Logs: `/home/USER/notebook-quality-20261113/python/ux-multipart-red.log` and
`linear-paragraphs-red.log` (the latter records a green baseline despite its name).
Green validation: 8 passed in 0.16 seconds in a separately coordinated quiet
window, including the same CPU bound and six old-regex semantic comparisons.
Log: `ux-multipart-green.log` beside the red log. No entire-suite or browser
validation was run. Newline cleanup in text_utils remains unchanged and
unassessed by executable complexity cases. No Sonar issue status was changed.

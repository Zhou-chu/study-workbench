# Bounded regular-expression reliability batch

This batch changes only grounded-chat response fence handling and the Markdown-link confidence heuristic. It does not change content limits, source text, extraction offsets, citation identities, live services or model execution.

## Demonstrated risks and replacements

1. `GroundedChatService._response`: the old closing-fence alternative `\s*```$` is unanchored at its beginning. For a long whitespace run not followed by a closing fence, search retries each whitespace suffix, giving quadratic work. A real valid JSON answer containing 80000 whitespace characters outside its value exceeded a 3-second child-process bound before the fix. The replacement strips the optional opening fence and terminal closing fence using prefix/suffix checks and bounded-count whole-string strip/slices. Case-sensitive optional `json`, independently optional opening/closing fences, Unicode whitespace and original malformed-input rejection are retained. This is O(n) fence preprocessing, not a claim that every downstream provider/text operation is bounded.

2. `_calculate_markdown_score`: the old link expression retries the remainder of a line at every unmatched `[`. The real function on 80000 opening brackets exceeded the same independent bound. `_count_markdown_links` now scans each LF-delimited line with monotonically advancing find operations. The first nonempty-label delimiter `](` can use the first eligible `)` at least one destination character later; if either is absent, no later start can succeed. Each successful match advances beyond its end; a failed scan abandons the line. Thus there is no repeated suffix search.

This preserves the historical regex heuristic rather than adopting a different Markdown parser: labels/destinations remain nonempty, nested delimiters retain their old treatment, matches are nonoverlapping, and only LF prevents a match (CR and Unicode line separators are ordinary dot-matching characters). No search offsets are returned or normalized by this helper. The confidence thresholds/weights are unchanged.

## Regression evidence

Before production changes, the two isolated real-function performance tests failed their 3-second bound; children were terminated/joined so the old regex could not hang the executor. Twenty fence compatibility cases passed before the fix. The final tests exercise 20000/80000/320000-character adversarial inputs, exhaustive strings of length0–6 over six delimiter/Unicode/LF characters, 2000 seeded Unicode examples and explicit nested/empty/unclosed/newline link cases. Each short-input count is compared with the unchanged historical regex. Malformed response cases remain errors.

Stable red/green logs: `/home/USER/notebook-quality-20261113/python/regex-boundaries/`. The offline runner uses isolated application paths and its network tripwire; no model/database service was contacted. Timing bounds are regression tripwires, not timing-based proof of linearity; the monotonic-scan reasoning above supplies the complexity argument.

## Reviewed but unchanged

`api.evidence_service._paragraphs` has a surprising existing behavior: `a\n\nb` forms a single regex match because the optional group first seeks a second non-whitespace character. A naive blank-line split would change source segments and offsets. This review has not established an adversarial superlinear case for that expression, so it was not changed or declared fixed.

`open_notebook.utils.text_utils` blank-line cleanup remains unchanged. Its surrounding operation already has a 100000-character processing limit, but this alone is not a proof of acceptable latency. No disposition or blanket safety claim is made for that finding in this batch.


## Cold-return path boundary (2026-11-14 candidate)

The trailing-slash regexp could retry a long nonterminal slash run quadratically. The candidate scans backward once and preserves URL parsing, decoded unsafe-character checks and login-loop rejection. A bounded Node child imports the real production function: the original algorithm exceeded the 3-second deadline for a 200,000-slash nonterminal run; the linear candidate passed. Two earlier harness attempts failed on an invalid transformed module URL and are not algorithm evidence.

Ten new unit cases cover encoded login paths, unsafe targets, preserved query/fragment, root and long-path handling. The original targeted group passed 17 cases; a fresh reconnect run passed all 10 new cases. ESLint and SPA TypeScript checks passed before reconnect. The child uses project-supported Node 24 native TypeScript and changes no process-global timeout. No real data or service is accessed.

This is not a complete web-suite pass. The preceding formal run still had three setup-journey flow timeouts; integrated flow coverage must not be described as pure unit coverage.

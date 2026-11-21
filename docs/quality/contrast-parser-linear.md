# Contrast checker lexical parser reliability

Base 739362f. Two actual old-expression CPU regressions failed before production
changes: repeated `:root ` without `}` (12000 occurrences, 72000 characters)
used 400613 microseconds CPU; a 40000-hyphen token name without colon used
1093924 microseconds CPU. The bound was 400000 microseconds. The root sample
is close to the threshold and alone is not an asymptotic proof. A separate bounded
old-expression sample measured 381778 microseconds for 12000 roots and 1271344
for 24000 roots (2x input, approximately 3.33x CPU); these observations support
the rescan diagnosis but are not a universal timing guarantee. Structural review
finds that unanchored matching retries the same suffix at every `:root` or `--`.
The baseline test read the actual checker's `const blocks` expression and evaluated
it in a VM with synthetic CSS; it did not substitute an invented slow parser.

The new pure `contrast-parser.mjs` scans each right-brace region once, preserving
the original first `:root` and last `{` that allows a nonempty body before the
first `}`. Failed regions cannot gain a match by starting at a later `:root`.
Token scanning processes maximal ASCII word/hyphen runs once. All `--` candidates
in a run share the same ending colon; a failed run can be skipped as a whole.
Whitespace and hex checks are constant-character/bounded-six-character tests.
Substrings traversed by each stage are disjoint, so total work and storage are
linear in input length. No input truncation, token deletion or relaxed contrast
threshold is used. This deliberately remains the historical lexical extractor,
not a new standards-compliant CSS parser.

Compatibility includes nonempty root bodies, nested brace greediness, case,
hyphen/underscore names, JavaScript whitespace (including BOM), duplicate keys,
`__proto__` as an own key via Object.fromEntries, and six-hex prefixes of longer
values. Number.parseInt only names the built-in alias explicitly; it is not
claimed as a functional bug fix.

Validation (separate scopes):
- 5 pure parser tests passed in 96.21 ms, including 3906 root arrangements and
  11111 token arrangements against the original regex oracle on bounded inputs.
  Malicious root/token shapes also pass unchanged CPU bounds.
- Actual `node apps/web/scripts/check-contrast.mjs` independently checked the
  repository CSS and all 24 existing pairs passed. This file-read command is
  not a pure parser unit test or a browser/accessibility audit.
- Node syntax checks and git diff whitespace check passed.
- No full-project suite, browser, Sonar rescan or issue state change was performed.

Evidence directory: `/home/USER/notebook-quality-20261113/`:
`contrast-parser-red.log`, `contrast-parser-equivalence.log`,
`contrast-parser-green.log`, `contrast-actual-24.log`, `contrast-root-scaling.json`.

Reproduce with fixed installed Node 24:
```
node --test apps/web/scripts/contrast-parser.test.mjs
node apps/web/scripts/check-contrast.mjs
```

Themes, runtime UI and deployment are unchanged. New helper/tests must be included
in normal source inventory; no coverage exclusions or manifest edits were made.

Independent integration review widened the committed root regression to 24,000
repetitions (144 KB), keeping the 0.4-second CPU bound. This avoids relying on
the first 72 KB baseline's marginal threshold exceedance; the retained old-code
2x sample demonstrates a substantially larger margin. No input is truncated.

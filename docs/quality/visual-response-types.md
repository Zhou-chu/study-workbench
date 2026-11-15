# Synthetic visual-review response container types

The runnable visual-review script returns both JSON objects and arrays from its
route fixture. Its local `value = {}` was inferred as dict[str, object], producing
ten assignment errors for list fixtures and narrower nested dictionaries.
The variable now explicitly accepts read-only Mapping[str, object] or
Sequence[object]; every actual branch still supplies the same built-in dict or
list. No Any, cast, ignored diagnostic, response-value change or check removal.
This annotation describes the outer response container, not a recursive JSON
schema or a guarantee that arbitrary custom Mapping objects are serializable.

Exact-file mypy first reported ten errors, then no errors in script plus test.
Eight response-shape/route fulfillment cases pass before and after; Ruff and
format checks pass. Tests extract only the real `api` function AST, supply
synthetic fixture values, and check response status, content type, decoded JSON
and request tracking. They never execute the script's top-level mkdir,
Playwright browser launch or screenshot workflow. Because source text is read
and compiled, these are tool-integration contracts, not strict unit coverage.
The script remains runnable; historical screenshots and raw evidence are not
rewritten. This is not a new live visual acceptance run.

# Native portable size regression — 2026-10-21

Command (repository virtualenv, native SurrealDB binary already installed):

```sh
.venv/bin/python scripts/v1/portable_limits_check.py \
  --out docs/v1/evidence/continuation-2026-10-21d/portable
```

**Passed** against real loopback HTTP, native SurrealDB, API and command worker,
with separate disposable database/filesystem instances for import and restore.

- Valid v1 input ZIP: **113,257,860 bytes**, above the old 104,857,600-byte cap.
- Genuine worker-produced export ZIP: **113,258,240 bytes**; fresh-instance import returned **201**, as did the initial import.
- All **21 manifest members** had independently checked SHA-256 and byte sizes in input and export; all ZIP members were stored without compression.
- **113,246,252-byte WAV** downloaded byte-for-byte (hash and length) from both instances. Artifact and notebook identities were remapped; restored history stayed non-replayable.
- Anonymous portable request advertising over-budget body returned **401 without sending any body**. Authenticated unrelated source-upload request advertising 101 MiB returned **413 without sending any body**. Authenticated portable request advertising one byte above its 1 GiB + 1 MiB HTTP budget returned **413 without sending any body**.
- Authenticated limits endpoint reported 1 GiB archive/expanded budget, 1 MiB multipart overhead, 32 MiB entity metadata limit and 8 MiB manifest limit.

The payload is a deterministic, public-domain synthetic silent mono 16-bit
16 kHz PCM WAV (108 MiB samples plus valid header), not a claim of Google/model
generation or browser playback. It deliberately exercises real large binary
artifact storage without inflating JSON metadata or relying on compression.
This is a >100 MiB regression, **not** an executed 1 GiB boundary test; advertised
oversize probes prove early rejection, not streaming-body overflow behavior.

Only allowlisted process environment variables were inherited; dotenv was
disabled, fixture credentials were public nonsecrets, and random loopback ports
were used. All generated ZIP/WAV/database files and process logs remain under
ignored `.runtime/portable-limits-*`, not in Git/GitHub. No user data, private
configuration, Google session, inference, paid resource or remote deployment
was used. `portable-limits-results.json` is the sanitized execution evidence.

Script formatting and lint: `.venv/bin/ruff format --check
scripts/v1/portable_limits_check.py` and `.venv/bin/ruff check
scripts/v1/portable_limits_check.py` passed.

## Production Next and real browser path

The initial direct-API pass did **not** establish frontend transport success.
The old production Next external rewrite genuinely truncated this upload:
`next-rewrite-red.txt` contains the exact 100 MB body-cloning warning; the actual
113,257,860-byte POST returned HTTP 500. The `/api` proxy matcher exclusion did
not avoid the external rewrite's `cloneBodyStream` cap.

With the narrow streaming portable POST route built into production standalone:

```sh
PLAYWRIGHT_BROWSERS_PATH="$PWD/.runtime/browsers" \
  python scripts/v1/portable_limits_check.py \
  --frontend-standalone --browser-restore \
  --out docs/v1/evidence/continuation-2026-10-21d/portable/next
```

This command uses the Python containing Playwright/httpx, but launches the
backend with the repository virtualenv. Production rewrites must have been
built with `INTERNAL_API_URL=http://127.0.0.1:5055`. The disposable API therefore
uses loopback port 5055; DB/frontend ports remain random. No global Next body
clone budget was raised.

The production Next path passed the large import and genuine worker export.
A fresh native DB/filesystem then received that exported ZIP through **real
Firefox PortableControls**: file input, authenticated server-limits response
200, enabled Confirm button, restore POST 201, and visible restored-notebook
link. Screenshots and `next/portable-limits-results.json` capture this flow;
there were no browser page errors, and non-frontend network requests were
blocked. The restored artifact was independently downloaded through Next and
its complete hash and length checked. Both phases rejected authenticated
`Origin: https://evil.invalid` with 403; the successful large POST used the
allowlisted frontend origin. Header-only early-rejection checks remain
**direct API probes**, not a claim about pre-body behavior through Next.

Final direct-API and production-Next/browser executions were repeated after
single-file multipart enforcement and ZIP central-directory preflight landed.
Both passed. The final browser screenshots were captured with animations
disabled after dialog opacity reached 1 and visually inspected: centered,
opaque restore dialog, readable 113,258,240-byte package size, and visible
restored-notebook link after completion. Script Ruff checks/format and targeted
mypy also passed. All owned service/browser processes exited after verification.

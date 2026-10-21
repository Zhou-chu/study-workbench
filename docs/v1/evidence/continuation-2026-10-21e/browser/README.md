# Recovery and first-use browser verification — 2026-10-21

**Result:** passed, seven scenarios in `results.json`. Firefox, Chinese locale; production Next build; real disposable native SurrealDB, API and extraction worker. Desktop 1440×1000, mobile 390×844.

```bash
PLAYWRIGHT_BROWSERS_PATH=$PWD/.runtime/browsers \
  python scripts/v1/ux_recovery_check.py \
  --out docs/v1/evidence/continuation-2026-10-21e/browser
```

Requires a completed production frontend build and exclusive API port 5055. The script starts and stops its own isolated stack. This successful run exited normally after process cleanup; no verification services remain running.

## What was real versus controlled

- Real notebook-list link, first-use CTA, file chooser, keyboard actions, selection and recovery controls in Firefox.
- Real upload reached and committed in the API; a browser route interceptor fetched the successful response and deliberately aborted its delivery once. Manual keyboard retry reused identical file bytes and idempotency key, returned the same upload result, and left exactly one backend source and one version.
- Real CPU text extraction. A controlled initial reader HTTP 503 was followed by explicit retry against the actual backend, with no page reload and unchanged unsaved note and question drafts.
- Actual unconfigured model defaults. Controlled defaults HTTP 503 and a held retry request exercised error and loading states; both question and outline controls remained disabled. Releasing the request returned the real unconfigured state. No provider was configured or called.
- Real task display used “提取资料文字”; raw operation/submission details were hidden until keyboard expansion.
- First-use reassurance and CTA were visible on mobile. Keyboard activation selected Sources and focused the upload input without sending an upload or changing the empty scope. Optional Google disclosure opened/closed by keyboard without external actions.

No private configuration, Google operations, real credentials, external services, or model calls were used. Fixtures were authored public test text. These are controlled regression checks, **not observations of a real outage or research with real users**. Browser requests were loopback-only, with question submission guarded. Zero page errors or blocked external/question requests were observed.

All three mobile panels measured document width 390 and height 844, equal to the viewport. Screenshots contain only public synthetic fixture data. Earlier harness-only wait/engine-selection corrections were rerun from fresh fixtures; obsolete failure screenshots are not published here.

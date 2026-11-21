"""Explicit read-only verification; default is a visible blocked report.

Exit codes: 0 verified connection, 1 unexpected failure, 2 no explicit opt-in,
3 incomplete/unavailable verification. No provider imports occur before opt-in.
"""

import asyncio
import json
import os


async def main() -> int:
    if os.getenv("STUDY_WORKBENCH_LIVE_READONLY") != "1":
        print(
            json.dumps(
                {
                    "status": "blocked",
                    "reason": "No authorized live read-only check requested. No Google/model calls made.",
                }
            )
        )
        return 2
    try:
        from open_notebook.integrations.notebooklm.sdk_adapter import (
            SDKNotebookLMBridge,
        )

        bridge = SDKNotebookLMBridge()
        # verify_connection performs only authentication plus notebook listing.
        status = await bridge.verify_connection()
        verified = (
            status.state == "connected"
            and isinstance(status.last_verified_at, str)
            and bool(status.last_verified_at.strip())
        )
        report = status.model_dump_json()
    except Exception:
        # Exceptions can contain profile paths or credentials: never print them.
        print(
            json.dumps(
                {
                    "status": "failed",
                    "reason": "Live read-only verification could not complete.",
                }
            )
        )
        return 1
    print(report)
    return 0 if verified else 3


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

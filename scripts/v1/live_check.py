"""Explicit read-only external verification. Default is a visible blocked report."""

import asyncio
import json
import os


async def main():
    if os.getenv("STUDY_WORKBENCH_LIVE_READONLY") != "1":
        print(
            json.dumps(
                {
                    "status": "blocked",
                    "reason": "No authorized live read-only check requested. No Google/model calls made.",
                }
            )
        )
        return
    from open_notebook.integrations.notebooklm.sdk_adapter import SDKNotebookLMBridge

    bridge = SDKNotebookLMBridge()
    status = await bridge.verify_connection()
    print(status.model_dump_json())
    # verify_connection performs only authentication plus notebook listing.


if __name__ == "__main__":
    asyncio.run(main())

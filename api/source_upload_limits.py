"""Source-upload byte budget shared by admission and client capabilities."""

import os


def get_source_upload_max_bytes() -> int:
    # Preserve the deployed configuration and fractional-MB calculation exactly.
    return int(float(os.getenv("STUDY_WORKBENCH_MAX_FILE_MB", "50")) * 1024 * 1024)

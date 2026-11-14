"""Filesystem adapter contract; in-memory ZIP cases live in the unit suite."""

import io
import zipfile

from test_portable_zip_unit import archive_bytes, validate


def test_path_input_and_archive_comment(tmp_path):
    stream = io.BytesIO(archive_bytes())
    with zipfile.ZipFile(stream, "a") as package:
        package.comment = b"archive comment"
    path = tmp_path / "project.zip"
    path.write_bytes(stream.getvalue())
    validate(path, 3)

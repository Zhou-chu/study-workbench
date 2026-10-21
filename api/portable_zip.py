"""Bound ZIP directory object amplification before constructing ``ZipFile``.

The stdlib's ZIP64-aware EOCD reader is deliberately isolated here. It reads
only bounded end records, unlike ZipFile, which allocates the entire directory
and a ZipInfo per entry before callers can enforce their entry limit. Variable
comments/extra fields are skipped, not copied. This is not an absolute memory
cap: a permitted directory with large metadata is still read by ZipFile later.
"""

import os
import struct
import zipfile
from contextlib import nullcontext
from typing import Any, cast

from open_notebook.exceptions import InvalidInputError

# Typeshed intentionally omits private ZIP internals. Keep this untyped adapter
# confined to the EOCD compatibility boundary; public ZipFile remains typed.
_zip = cast(Any, zipfile)


def validate_zip_directory(archive, max_entries: int) -> None:
    """Validate directory framing/count without ZipInfo allocation; preserve seek."""
    try:
        context = (
            open(archive, "rb")
            if isinstance(archive, (str, os.PathLike))
            else nullcontext(archive)
        )
        with context as stream:
            position = stream.tell()
            try:
                stream.seek(0, os.SEEK_END)
                physical_size = stream.tell()
                endrec = _zip._EndRecData(stream)
                if endrec is None:
                    raise InvalidInputError("Invalid portable ZIP directory")
                if endrec[_zip._ECD_ENTRIES_TOTAL] > max_entries:
                    raise InvalidInputError(
                        "Archive entry count exceeds configured limit"
                    )
                size = endrec[_zip._ECD_SIZE]
                end = endrec[_zip._ECD_LOCATION]
                # Current patched Python normalizes LOCATION to the ZIP64 EOCD.
                # Older supported Python keeps the ordinary EOCD location and
                # ZipFile subtracts the fixed ZIP64 EOCD + locator instead.
                if endrec[_zip._ECD_SIGNATURE] == _zip.stringEndArchive64:
                    stream.seek(end)
                    if stream.read(4) == _zip.stringEndArchive:
                        end -= _zip.sizeEndCentDir64 + _zip.sizeEndCentDir64Locator
                start = end - size
                if start < 0 or end > physical_size or end < start:
                    raise InvalidInputError("Invalid portable ZIP directory bounds")
                stream.seek(start)
                count = 0
                while stream.tell() < end:
                    if end - stream.tell() < _zip.sizeCentralDir:
                        raise InvalidInputError("Truncated portable ZIP directory")
                    header = stream.read(_zip.sizeCentralDir)
                    if len(header) != _zip.sizeCentralDir:
                        raise InvalidInputError("Truncated portable ZIP directory")
                    fields = struct.unpack(_zip.structCentralDir, header)
                    if fields[_zip._CD_SIGNATURE] != _zip.stringCentralDir:
                        raise InvalidInputError("Invalid portable ZIP directory entry")
                    count += 1
                    if count > max_entries:
                        raise InvalidInputError(
                            "Archive entry count exceeds configured limit"
                        )
                    variable_size = sum(
                        fields[index]
                        for index in (
                            _zip._CD_FILENAME_LENGTH,
                            _zip._CD_EXTRA_FIELD_LENGTH,
                            _zip._CD_COMMENT_LENGTH,
                        )
                    )
                    if variable_size > end - stream.tell():
                        raise InvalidInputError(
                            "Truncated portable ZIP directory entry"
                        )
                    stream.seek(variable_size, os.SEEK_CUR)
            finally:
                stream.seek(position)
    except (OSError, ValueError, struct.error, zipfile.BadZipFile) as exc:
        raise InvalidInputError("Invalid portable ZIP directory") from exc

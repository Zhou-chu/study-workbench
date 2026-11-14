"""Directory preflight bounds ZipInfo construction before opening an archive."""

import io
import struct
import zipfile
from typing import Any, cast

import pytest

from open_notebook.exceptions import InvalidInputError

# Typeshed intentionally omits private ZIP internals. Keep this untyped adapter
# confined to the EOCD compatibility boundary; public ZipFile remains typed.
_zip = cast(Any, zipfile)


def archive_bytes(count=3, zip64=False):
    stream = io.BytesIO()
    old = _zip.ZIP_FILECOUNT_LIMIT
    try:
        if zip64:
            _zip.ZIP_FILECOUNT_LIMIT = 1
        with zipfile.ZipFile(stream, "w") as package:
            for index in range(count):
                package.writestr(f"entry-{index}", b"data")
    finally:
        _zip.ZIP_FILECOUNT_LIMIT = old
    return stream.getvalue()


def validate(archive, limit):
    from api.portable_zip import validate_zip_directory

    return validate_zip_directory(archive, limit)


@pytest.mark.parametrize("zip64", [False, True])
@pytest.mark.parametrize("prefix", [b"", b"prepended bytes"])
def test_exact_limit_and_zip64_preserve_position(zip64, prefix):
    stream = io.BytesIO(prefix + archive_bytes(zip64=zip64))
    stream.seek(7)
    validate(stream, 3)
    assert stream.tell() == 7
    assert not stream.closed
    with zipfile.ZipFile(stream) as package:
        assert len(package.infolist()) == 3


@pytest.mark.parametrize("zip64", [False, True])
def test_over_limit_rejected_before_zipinfo_construction(monkeypatch, zip64):
    stream = io.BytesIO(archive_bytes(zip64=zip64))
    stream.seek(2)

    def forbidden(*args, **kwargs):
        raise AssertionError("Preflight must not construct ZipInfo objects")

    monkeypatch.setattr(zipfile, "ZipInfo", forbidden)
    with pytest.raises(InvalidInputError, match="entry count"):
        validate(stream, 2)
    assert stream.tell() == 2


def test_forged_low_eocd_count_still_rejects_actual_entries():
    raw = bytearray(archive_bytes())
    struct.pack_into("<HH", raw, len(raw) - 22 + 8, 1, 1)
    with pytest.raises(InvalidInputError, match="entry count"):
        validate(io.BytesIO(raw), 2)


@pytest.mark.parametrize(
    "damage", ["size", "signature", "variable_length", "short_header"]
)
def test_malformed_directory_is_typed_error_and_preserves_position(damage):
    raw = bytearray(archive_bytes())
    eocd = len(raw) - 22
    start = raw.index(b"PK\x01\x02")
    if damage == "size":
        struct.pack_into("<I", raw, eocd + 12, len(raw) + 1)
    elif damage == "signature":
        raw[start : start + 4] = b"NOPE"
    elif damage == "variable_length":
        struct.pack_into("<H", raw, start + 28, 65535)
    else:
        struct.pack_into("<I", raw, eocd + 12, 4)
    stream = io.BytesIO(raw)
    stream.seek(1)
    with pytest.raises(InvalidInputError):
        validate(stream, 3)
    assert stream.tell() == 1


def test_variable_metadata_is_skipped_not_materialized():
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as package:
        info = zipfile.ZipInfo("entry")
        info.comment = b"x" * 60000
        package.writestr(info, b"payload")

    class BoundedRead(io.BytesIO):
        def read(self, size=-1):
            assert 0 <= size <= 65558
            return super().read(size)

    validate(BoundedRead(stream.getvalue()), 1)


def test_invalid_zip_rejected():
    with pytest.raises(InvalidInputError):
        validate(io.BytesIO(b"not a zip"), 3)


def test_forged_low_zip64_count_still_rejects_actual_entries():
    raw = bytearray(archive_bytes(zip64=True))
    end64 = raw.index(_zip.stringEndArchive64)
    struct.pack_into("<QQ", raw, end64 + 24, 1, 1)
    with pytest.raises(InvalidInputError, match="entry count"):
        validate(io.BytesIO(raw), 2)


def test_older_python_zip64_location_convention(monkeypatch):
    original = _zip._EndRecData

    def legacy_location(stream):
        record = original(stream)
        assert record[_zip._ECD_SIGNATURE] == _zip.stringEndArchive64
        record[_zip._ECD_LOCATION] += (
            _zip.sizeEndCentDir64 + _zip.sizeEndCentDir64Locator
        )
        return record

    monkeypatch.setattr(zipfile, "_EndRecData", legacy_location)
    validate(io.BytesIO(archive_bytes(zip64=True)), 3)


def test_zip64_extensible_data_matches_stdlib():
    raw = bytearray(archive_bytes(zip64=True))
    end64 = raw.index(_zip.stringEndArchive64)
    locator = raw.index(_zip.stringEndArchive64Locator)
    extension = b"extension bytes"
    struct.pack_into("<Q", raw, end64 + 4, 44 + len(extension))
    raw[locator:locator] = extension
    with zipfile.ZipFile(io.BytesIO(raw)) as package:
        assert len(package.infolist()) == 3
    validate(io.BytesIO(raw), 3)

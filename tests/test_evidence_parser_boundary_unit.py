"""Evidence parser results and worker lifecycle with fake reader and worker edges."""

from pathlib import PurePosixPath
from types import SimpleNamespace
from unittest.mock import Mock

import pypdf
import pytest

from api import evidence_service as service
from open_notebook.exceptions import InvalidInputError


@pytest.fixture
def reader(monkeypatch):
    fake = Mock()
    monkeypatch.setattr(pypdf, "PdfReader", fake)
    return fake


@pytest.mark.parametrize(
    ("texts", "status", "warnings"),
    [
        (["First page", "Second page"], "ready", []),
        (
            ["First page", None],
            "partial",
            ["NEEDS_OCR: PDF page 2 has no extractable text"],
        ),
        (
            [None, "   "],
            "needs_ocr",
            [
                "NEEDS_OCR: PDF page 1 has no extractable text",
                "NEEDS_OCR: PDF page 2 has no extractable text",
            ],
        ),
        ([], "needs_ocr", []),
    ],
)
def test_pdf_projection_keeps_page_order_indices_and_ocr_status(
    reader, texts, status, warnings
):
    reader.return_value = SimpleNamespace(
        is_encrypted=False,
        pages=[SimpleNamespace(extract_text=Mock(return_value=text)) for text in texts],
    )

    result = service._parse_original("chapter.pdf", "application/pdf", 2, 100)

    reader.assert_called_once_with("chapter.pdf", strict=False)
    assert result == {
        "blocks": [
            {"block_id": f"page_{index:04d}", "page_index": index, "text": text or ""}
            for index, text in enumerate(texts)
        ],
        "page_count": len(texts),
        "warnings": warnings,
        "status": status,
    }


def test_pdf_page_limit_is_checked_before_extracting_pages(reader):
    page = SimpleNamespace(extract_text=Mock(return_value="Chapter"))
    reader.return_value = SimpleNamespace(is_encrypted=False, pages=[page, page])

    with pytest.raises(ValueError, match="PAGE_LIMIT"):
        service._parse_original("chapter.pdf", "application/pdf", 1, 100)

    page.extract_text.assert_not_called()


def test_pdf_text_limit_is_cumulative_across_ordered_pages(reader):
    first = SimpleNamespace(extract_text=Mock(return_value="1234"))
    second = SimpleNamespace(extract_text=Mock(return_value="5678"))
    unused = SimpleNamespace(extract_text=Mock())
    reader.return_value = SimpleNamespace(
        is_encrypted=False, pages=[first, second, unused]
    )

    with pytest.raises(ValueError, match="TEXT_LIMIT"):
        service._parse_original("chapter.pdf", "application/pdf", 4, 7)

    first.extract_text.assert_called_once_with()
    second.extract_text.assert_called_once_with()
    unused.extract_text.assert_not_called()


def test_text_original_reads_once_and_preserves_utf8_result(monkeypatch):
    fake_file = Mock()
    fake_file.read_bytes.return_value = b"\xef\xbb\xbfChapter One"
    path = Mock(return_value=fake_file)
    monkeypatch.setattr(service, "Path", path)

    assert service._parse_original("chapter.txt", "text/plain", 2, 20) == {
        "blocks": [{"block_id": "document", "page_index": None, "text": "Chapter One"}],
        "page_count": None,
        "warnings": [],
        "status": "ready",
    }
    fake_file.read_bytes.assert_called_once_with()
    path.assert_called_once_with("chapter.txt")


@pytest.mark.parametrize("reader_error", [None, OSError("Original file unavailable")])
def test_parser_worker_delivers_one_result_and_closes_pipe(reader, reader_error):
    reader.return_value = SimpleNamespace(
        is_encrypted=False,
        pages=[SimpleNamespace(extract_text=Mock(return_value="Chapter"))],
    )
    reader.side_effect = reader_error
    child_pipe = Mock()

    service._parser_process(child_pipe, ("chapter.pdf", "application/pdf", 1, 20))

    child_pipe.close.assert_called_once_with()
    child_pipe.send.assert_called_once()
    payload = child_pipe.send.call_args.args[0]
    if reader_error is None:
        assert payload["ok"]["status"] == "ready"
        assert payload["ok"]["blocks"][0]["text"] == "Chapter"
    else:
        assert payload == {"error": "Original file unavailable"}


@pytest.fixture
def worker(monkeypatch):
    receive, send, process = Mock(), Mock(), Mock()
    context = Mock()
    context.Pipe.return_value = (receive, send)
    context.Process.return_value = process
    get_context = Mock(return_value=context)
    monkeypatch.setattr(
        service, "multiprocessing", SimpleNamespace(get_context=get_context)
    )
    process.is_alive.side_effect = [False, False]
    receive.poll.return_value = True
    return SimpleNamespace(
        receive=receive,
        send=send,
        process=process,
        context=context,
        get_context=get_context,
    )


def run_parser():
    return service._bounded_parse(
        PurePosixPath("chapter.pdf"), "application/pdf", 6, 0.25, 100
    )


def test_dispatch_accepts_ready_result_and_releases_worker(worker):
    payload = {"status": "ready", "page_count": 2}
    worker.receive.recv.return_value = {"ok": payload}

    assert run_parser() == payload

    worker.get_context.assert_called_once_with("spawn")
    worker.context.Pipe.assert_called_once_with(duplex=False)
    worker.context.Process.assert_called_once_with(
        target=service._parser_process,
        args=(worker.send, ("chapter.pdf", "application/pdf", 6, 100)),
        daemon=True,
    )
    worker.process.start.assert_called_once_with()
    worker.send.close.assert_called_once_with()
    worker.receive.poll.assert_called_once_with(0.25)
    worker.receive.close.assert_called_once_with()
    worker.process.join.assert_called_once_with(timeout=2)
    worker.process.close.assert_called_once_with()
    worker.process.terminate.assert_not_called()


def test_dispatch_timeout_terminates_and_reaps_busy_worker(worker):
    worker.receive.poll.return_value = False
    worker.process.is_alive.side_effect = [True, True]

    with pytest.raises(InvalidInputError, match="EXTRACTION_TIMEOUT"):
        run_parser()

    worker.receive.recv.assert_not_called()
    worker.receive.close.assert_called_once_with()
    worker.process.terminate.assert_called_once_with()
    worker.process.kill.assert_called_once_with()
    assert worker.process.join.call_count == 2
    worker.process.close.assert_called_once_with()


@pytest.mark.parametrize("reply", [EOFError(), {"error": "Original file unavailable"}])
def test_dispatch_reports_unavailable_worker_or_original_without_partial_success(
    worker, reply
):
    if isinstance(reply, Exception):
        worker.receive.recv.side_effect = reply
    else:
        worker.receive.recv.return_value = reply

    with pytest.raises(InvalidInputError, match="EXTRACTION_FAILED"):
        run_parser()

    worker.receive.close.assert_called_once_with()
    worker.process.close.assert_called_once_with()

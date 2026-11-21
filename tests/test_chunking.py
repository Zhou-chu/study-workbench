"""
Tokenizer and splitter integration tests for chunking.

Literal detection cases are preserved in test_chunking_detection_unit.py.
"""

import pytest

from open_notebook.utils.chunking import (
    CHUNK_SIZE,
    MIN_CHUNK_SIZE,
    ContentType,
    chunk_text,
)
from open_notebook.utils.token_utils import token_count


def _build_text_with_max_tokens(fragment: str, max_tokens: int) -> str:
    """Build text that stays within a token budget."""
    text = ""
    while True:
        candidate = text + fragment
        if token_count(candidate) > max_tokens:
            return text
        text = candidate


def _build_text_exceeding_tokens(fragment: str, threshold_tokens: int) -> str:
    """Build text that exceeds a token threshold."""
    text = fragment
    while token_count(text) <= threshold_tokens:
        text += fragment
    return text


def _assert_chunks_within_token_limit(chunks: list[str]) -> None:
    """Assert chunks stay within the configured token window."""
    assert chunks
    for chunk in chunks:
        assert token_count(chunk) <= CHUNK_SIZE


class TestChunkText:
    """Test suite for text chunking functionality."""

    def test_empty_text(self):
        """Test chunking empty text."""
        assert chunk_text("") == []
        assert chunk_text("   ") == []

    def test_short_text_no_chunking(self):
        """Test that short text is not chunked."""
        text = "This is a short text."
        chunks = chunk_text(text)
        assert len(chunks) == 1
        assert chunks[0] == text

    def test_text_at_chunk_limit(self):
        """Test text within the token chunk size limit."""
        text = _build_text_with_max_tokens("This is a sentence. ", CHUNK_SIZE)
        assert token_count(text) <= CHUNK_SIZE
        chunks = chunk_text(text)
        assert len(chunks) == 1

    def test_long_text_is_chunked(self):
        """Test that long English text is chunked by token budget."""
        text = _build_text_exceeding_tokens("This is a sentence. ", CHUNK_SIZE)
        chunks = chunk_text(text)
        assert len(chunks) > 1
        _assert_chunks_within_token_limit(chunks)

    def test_cjk_text_is_chunked_by_tokens(self):
        """Test that long CJK text is chunked using token measurement."""
        text = _build_text_exceeding_tokens(
            "這是一段中文內容，用來驗證分塊邏輯。", CHUNK_SIZE
        )
        chunks = chunk_text(text, content_type=ContentType.PLAIN)
        assert len(chunks) > 1
        _assert_chunks_within_token_limit(chunks)

    def test_mixed_language_text_is_chunked_by_tokens(self):
        """Test that mixed-language text is chunked using token measurement."""
        fragment = (
            "This paragraph mixes English and 中文內容 to verify token-based chunking. "
        )
        text = _build_text_exceeding_tokens(fragment, CHUNK_SIZE)
        chunks = chunk_text(text, content_type=ContentType.PLAIN)
        assert len(chunks) > 1
        _assert_chunks_within_token_limit(chunks)

    def test_explicit_content_type_html(self):
        """Test chunking with explicit HTML content type."""
        html_text = """<html>
<body>
<h1>Main Title</h1>
<p>First paragraph with lots of content.</p>
<h2>Section</h2>
<p>Second paragraph.</p>
</body>
</html>"""
        chunks = chunk_text(html_text, content_type=ContentType.HTML)
        assert len(chunks) >= 1

    def test_explicit_content_type_markdown(self):
        """Test chunking with explicit Markdown content type."""
        md_text = """# Main Title

Introduction paragraph.

## Section 1

Content for section 1.

## Section 2

Content for section 2.
"""
        chunks = chunk_text(md_text, content_type=ContentType.MARKDOWN)
        assert len(chunks) >= 1

    def test_explicit_content_type_plain(self):
        """Test chunking with explicit plain content type."""
        plain_text = _build_text_exceeding_tokens("Word ", CHUNK_SIZE)
        chunks = chunk_text(plain_text, content_type=ContentType.PLAIN)
        assert len(chunks) > 1
        _assert_chunks_within_token_limit(chunks)

    def test_file_path_detection(self):
        """Test chunking with file path for content type detection."""
        text = "Some content here"
        chunks = chunk_text(text, file_path="document.md")
        assert len(chunks) == 1

    def test_secondary_chunking_for_large_sections(self):
        """Test that large Markdown sections are further chunked by tokens."""
        large_section = _build_text_exceeding_tokens(
            "這是一段很長的章節內容，用來測試次級分塊。", CHUNK_SIZE
        )
        md_text = f"# Title\n\n{large_section}"
        chunks = chunk_text(md_text, content_type=ContentType.MARKDOWN)
        assert len(chunks) > 1
        _assert_chunks_within_token_limit(chunks)

    def test_drops_degenerate_short_chunks(self):
        """Header splitters can emit single-char chunks; they must be filtered."""
        large_section = _build_text_exceeding_tokens(
            "This is a paragraph with enough content to be useful. ", CHUNK_SIZE
        )
        # A trailing micro-section ("# .") would otherwise produce a "." chunk.
        md_text = f"# Real Title\n\n{large_section}\n\n# .\n"
        chunks = chunk_text(md_text, content_type=ContentType.MARKDOWN)
        assert len(chunks) >= 1
        assert all(token_count(c) >= MIN_CHUNK_SIZE for c in chunks)
        assert all(c.strip() not in (".", ",", ";", "#") for c in chunks)

    def test_filter_never_empties_result(self):
        """Even if every chunk would be dropped, at least one survives."""
        # Force the minimum threshold higher than any chunk could possibly be.
        # We exercise the safety branch by passing PLAIN content that splits
        # into multiple very-small chunks.
        text = ". " * 200  # Many tiny fragments after splitting
        chunks = chunk_text(text, content_type=ContentType.PLAIN)
        # The function must always return at least one chunk for non-empty input.
        assert len(chunks) >= 1


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

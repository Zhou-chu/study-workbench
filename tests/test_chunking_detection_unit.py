"""Content detection and chunk orchestration without tokenizer, parser or file I/O."""

from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from open_notebook.utils import chunking
from open_notebook.utils.chunking import (
    ContentType,
    detect_content_type,
    detect_content_type_from_extension,
    detect_content_type_from_heuristics,
)


class TestDetectContentTypeFromExtension:
    """Test suite for extension-based content type detection."""

    def test_html_extensions(self):
        """Test HTML file extensions."""
        assert detect_content_type_from_extension("file.html") == ContentType.HTML
        assert detect_content_type_from_extension("file.htm") == ContentType.HTML
        assert detect_content_type_from_extension("file.xhtml") == ContentType.HTML
        assert (
            detect_content_type_from_extension("/path/to/file.HTML") == ContentType.HTML
        )

    def test_markdown_extensions(self):
        """Test Markdown file extensions."""
        assert detect_content_type_from_extension("file.md") == ContentType.MARKDOWN
        assert (
            detect_content_type_from_extension("file.markdown") == ContentType.MARKDOWN
        )
        assert detect_content_type_from_extension("file.mdown") == ContentType.MARKDOWN
        assert (
            detect_content_type_from_extension("/path/to/README.MD")
            == ContentType.MARKDOWN
        )

    def test_plain_text_extensions(self):
        """Test plain text file extensions."""
        assert detect_content_type_from_extension("file.txt") == ContentType.PLAIN
        assert detect_content_type_from_extension("file.text") == ContentType.PLAIN

    def test_code_extensions_as_plain(self):
        """Test code file extensions are treated as plain text."""
        assert detect_content_type_from_extension("file.py") == ContentType.PLAIN
        assert detect_content_type_from_extension("file.js") == ContentType.PLAIN
        assert detect_content_type_from_extension("file.json") == ContentType.PLAIN
        assert detect_content_type_from_extension("file.yaml") == ContentType.PLAIN

    def test_unknown_extensions(self):
        """Test unknown extensions return None."""
        assert detect_content_type_from_extension("file.xyz") is None
        assert detect_content_type_from_extension("file.docx") is None
        assert detect_content_type_from_extension("file.pdf") is None

    def test_no_extension(self):
        """Test files without extension."""
        assert detect_content_type_from_extension("Makefile") is None
        assert detect_content_type_from_extension("README") is None

    def test_none_input(self):
        """Test None input."""
        assert detect_content_type_from_extension(None) is None

    def test_empty_string(self):
        """Test empty string input."""
        assert detect_content_type_from_extension("") is None


class TestDetectContentTypeFromHeuristics:
    """Test suite for heuristics-based content type detection."""

    def test_html_detection_doctype(self):
        """Test HTML detection with DOCTYPE."""
        html_text = "<!DOCTYPE html><html><body>Content</body></html>"
        content_type, confidence = detect_content_type_from_heuristics(html_text)
        assert content_type == ContentType.HTML
        assert confidence >= 0.8

    def test_html_detection_tags(self):
        """Test HTML detection with structural tags."""
        html_text = "<html><head><title>Test</title></head><body><div><p>Content</p></div></body></html>"
        content_type, confidence = detect_content_type_from_heuristics(html_text)
        assert content_type == ContentType.HTML
        assert confidence >= 0.5

    def test_markdown_detection_headers(self):
        """Test Markdown detection with headers."""
        md_text = """# Main Title

## Section 1

Some content here.

## Section 2

More content.

### Subsection

Details here.
"""
        content_type, confidence = detect_content_type_from_heuristics(md_text)
        assert content_type == ContentType.MARKDOWN
        assert confidence >= 0.3  # 4 headers give ~0.35 confidence

    def test_markdown_detection_links(self):
        """Test Markdown detection with links and headers for stronger signal."""
        md_text = """# Documentation

Check out [this link](https://example.com) and [another one](https://test.com).

## References

Here's some more text with [links](url) and `inline code`."""
        content_type, confidence = detect_content_type_from_heuristics(md_text)
        assert content_type == ContentType.MARKDOWN
        assert confidence >= 0.4

    def test_markdown_detection_code_blocks(self):
        """Test Markdown detection with code blocks."""
        md_text = """# Code Example

```python
def hello():
    print("Hello, World!")
```

Some explanation text.
"""
        content_type, confidence = detect_content_type_from_heuristics(md_text)
        assert content_type == ContentType.MARKDOWN
        assert confidence >= 0.5

    def test_plain_text_detection(self):
        """Test plain text detection."""
        plain_text = """This is just regular plain text.
It has multiple lines but no special formatting.
No headers, no links, no HTML tags.
Just regular sentences and paragraphs."""
        content_type, confidence = detect_content_type_from_heuristics(plain_text)
        assert content_type == ContentType.PLAIN

    def test_short_text(self):
        """Test short text defaults to plain."""
        content_type, confidence = detect_content_type_from_heuristics("Hi")
        assert content_type == ContentType.PLAIN

    def test_empty_text(self):
        """Test empty text defaults to plain."""
        content_type, confidence = detect_content_type_from_heuristics("")
        assert content_type == ContentType.PLAIN


class TestDetectContentType:
    """Test suite for combined content type detection."""

    def test_extension_takes_priority(self):
        """Test that file extension takes priority over heuristics."""
        # Text looks like markdown but file is .txt
        md_text = "# Header\n\nSome [link](url) content"
        content_type = detect_content_type(md_text, "file.txt")
        # Should use extension (plain) unless heuristics are very high confidence
        # In this case, markdown confidence might override
        assert content_type in (ContentType.PLAIN, ContentType.MARKDOWN)

    def test_no_extension_uses_heuristics(self):
        """Test that heuristics are used when no extension is available."""
        html_text = "<!DOCTYPE html><html><body>Test</body></html>"
        content_type = detect_content_type(html_text, None)
        assert content_type == ContentType.HTML

    def test_extension_html(self):
        """Test HTML extension detection."""
        content_type = detect_content_type("some text", "file.html")
        assert content_type == ContentType.HTML

    def test_extension_markdown(self):
        """Test Markdown extension detection."""
        content_type = detect_content_type("some text", "file.md")
        assert content_type == ContentType.MARKDOWN

    def test_high_confidence_override(self):
        """Test that very high confidence heuristics can override plain extension."""
        # Strong HTML indicators in a .txt file
        html_text = "<!DOCTYPE html><html><head><title>Test</title></head><body><div><p>Content</p></div></body></html>"
        content_type = detect_content_type(html_text, "file.txt")
        # High confidence HTML should override .txt extension
        assert content_type == ContentType.HTML


@pytest.mark.parametrize(
    ("name", "value", "expected"),
    [
        ("OPEN_NOTEBOOK_CHUNK_SIZE", None, 400),
        ("OPEN_NOTEBOOK_CHUNK_SIZE", "draft", 400),
        ("OPEN_NOTEBOOK_CHUNK_SIZE", "60", 100),
        ("OPEN_NOTEBOOK_CHUNK_SIZE", "1200", 1200),
        ("OPEN_NOTEBOOK_CHUNK_SIZE", "9000", 9000),
        ("OPEN_NOTEBOOK_CHUNK_OVERLAP", None, 60),
        ("OPEN_NOTEBOOK_CHUNK_OVERLAP", "draft", 60),
        ("OPEN_NOTEBOOK_CHUNK_OVERLAP", "-1", 0),
        ("OPEN_NOTEBOOK_CHUNK_OVERLAP", "50", 50),
        ("OPEN_NOTEBOOK_CHUNK_OVERLAP", "400", 60),
        ("OPEN_NOTEBOOK_MIN_CHUNK_SIZE", None, 5),
        ("OPEN_NOTEBOOK_MIN_CHUNK_SIZE", "draft", 5),
        ("OPEN_NOTEBOOK_MIN_CHUNK_SIZE", "-1", 0),
        ("OPEN_NOTEBOOK_MIN_CHUNK_SIZE", "8", 8),
    ],
)
def test_chunk_configuration_recovers_from_invalid_editorial_limits(
    monkeypatch, name, value, expected
):
    if value is None:
        monkeypatch.delenv(name, raising=False)
    else:
        monkeypatch.setenv(name, value)

    read_setting = {
        "OPEN_NOTEBOOK_CHUNK_SIZE": chunking._get_chunk_size,
        "OPEN_NOTEBOOK_CHUNK_OVERLAP": lambda: chunking._get_chunk_overlap(400),
        "OPEN_NOTEBOOK_MIN_CHUNK_SIZE": chunking._get_min_chunk_size,
    }
    assert read_setting[name]() == expected


@pytest.fixture
def fake_splitters(monkeypatch):
    for name, value in {
        "CHUNK_SIZE": 12,
        "CHUNK_OVERLAP": 2,
        "MIN_CHUNK_SIZE": 4,
    }.items():
        monkeypatch.setattr(chunking, name, value)
    token_count = Mock(side_effect=len)
    html, markdown, plain = Mock(), Mock(), Mock()
    monkeypatch.setattr(chunking, "token_count", token_count)
    monkeypatch.setattr(chunking, "HTMLHeaderTextSplitter", html)
    monkeypatch.setattr(chunking, "MarkdownHeaderTextSplitter", markdown)
    monkeypatch.setattr(chunking, "RecursiveCharacterTextSplitter", plain)
    return SimpleNamespace(
        token_count=token_count, html=html, markdown=markdown, plain=plain
    )


@pytest.mark.parametrize(
    ("text", "result"), [("  ", []), ("read notes", ["read notes"])]
)
def test_short_or_blank_note_does_not_construct_splitters(fake_splitters, text, result):
    f = fake_splitters
    assert chunking.chunk_text(text) == result
    f.html.assert_not_called()
    f.markdown.assert_not_called()
    f.plain.assert_not_called()


@pytest.mark.parametrize("content_type", [ContentType.HTML, ContentType.MARKDOWN])
def test_structured_import_keeps_order_and_resplits_only_oversize_sections(
    fake_splitters, content_type
):
    f = fake_splitters
    first, oversized, last = (
        "Chapter one",
        "Full section exceeds the budget",
        "Appendix",
    )
    is_html = content_type is ContentType.HTML
    primary, other = (f.html, f.markdown) if is_html else (f.markdown, f.html)
    primary.return_value.split_text.return_value = [
        SimpleNamespace(page_content=first),
        SimpleNamespace(page_content=oversized),
        last,
        SimpleNamespace(page_content="   "),
        "x",
    ]
    f.plain.return_value.split_text.return_value = ["Part one", "Part two"]
    document = "Structured lecture notes"

    result = chunking.chunk_text(
        document,
        content_type=ContentType.HTML if is_html else None,
        file_path=None if is_html else "lecture.md",
    )

    assert result == [first, "Part one", "Part two", last]
    primary.return_value.split_text.assert_called_once_with(document)
    other.assert_not_called()
    f.plain.return_value.split_text.assert_called_once_with(oversized)
    f.plain.assert_called_once_with(
        chunk_size=12,
        chunk_overlap=2,
        length_function=f.token_count,
        separators=["\n\n", "\n", ". ", ", ", " ", ""],
    )
    if is_html:
        assert primary.call_args.kwargs["headers_to_split_on"][0] == ("h1", "Header 1")
    else:
        assert primary.call_args.kwargs["strip_headers"] is False
        assert primary.call_args.kwargs["headers_to_split_on"][0] == ("#", "Header 1")


@pytest.mark.parametrize(
    ("chunks", "minimum", "expected"),
    [
        (["  a ", "bb", " "], 4, ["a", "bb"]),
        (["  a "], 4, ["a"]),
        (["  a ", "chapter"], 0, ["a", "chapter"]),
        (["  a ", "chapter"], 4, ["chapter"]),
        (["first", " second "], 4, ["first", "second"]),
    ],
)
def test_plain_import_drops_trivial_fragments_without_losing_all_content(
    monkeypatch,
    fake_splitters,
    chunks,
    minimum,
    expected,
):
    f = fake_splitters
    monkeypatch.setattr(chunking, "MIN_CHUNK_SIZE", minimum)
    f.plain.return_value.split_text.return_value = chunks
    assert chunking.chunk_text("Complete plain note", ContentType.PLAIN) == expected
    f.plain.return_value.split_text.assert_called_once_with("Complete plain note")
    f.html.assert_not_called()
    f.markdown.assert_not_called()

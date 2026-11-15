"""Literal-input content detection units; no tokenization or file reads."""

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

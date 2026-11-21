"""Resolve version metadata from the actual installed package environment."""

import pytest

from open_notebook.utils import get_installed_version


class TestVersionUtilities:
    """Test suite for version management functions."""

    def test_get_installed_version_success(self):
        """Test getting installed package version."""
        # Test with a known installed package
        version = get_installed_version("pytest")
        assert isinstance(version, str)
        assert len(version) > 0
        # Should look like a version (has dots)
        assert "." in version

    def test_get_installed_version_not_found(self):
        """Test getting version of non-existent package."""
        from importlib.metadata import PackageNotFoundError

        with pytest.raises(PackageNotFoundError):
            get_installed_version("this-package-does-not-exist-12345")

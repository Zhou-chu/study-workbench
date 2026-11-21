"""SourceCreate array length and defaults through direct schema construction."""

import pytest
from pydantic import ValidationError
from source_create_array_fixtures import make_ids

from api.models import SourceCreate


class TestNotebooksMaxLength:
    def test_accepts_up_to_50_notebooks(self):
        request = SourceCreate(
            type="text", content="hi", notebooks=make_ids(50, "notebook")
        )
        assert request.notebooks is not None
        assert len(request.notebooks) == 50

    def test_rejects_51_notebooks(self):
        with pytest.raises(ValidationError):
            SourceCreate(type="text", content="hi", notebooks=make_ids(51, "notebook"))

    def test_none_notebooks_still_allowed(self):
        # Pre-existing behavior (validate_notebook_fields): None normalizes
        # to an empty list, unrelated to the max_length addition.
        request = SourceCreate(type="text", content="hi", notebooks=None)
        assert request.notebooks == []

    def test_empty_list_still_allowed(self):
        request = SourceCreate(type="text", content="hi", notebooks=[])
        assert request.notebooks == []


class TestTransformationsMaxLength:
    def test_accepts_up_to_50_transformations(self):
        request = SourceCreate(
            type="text", content="hi", transformations=make_ids(50, "transformation")
        )
        assert request.transformations is not None
        assert len(request.transformations) == 50

    def test_rejects_51_transformations(self):
        with pytest.raises(ValidationError):
            SourceCreate(
                type="text",
                content="hi",
                transformations=make_ids(51, "transformation"),
            )

    def test_default_is_empty_list(self):
        request = SourceCreate(type="text", content="hi")
        assert request.transformations == []

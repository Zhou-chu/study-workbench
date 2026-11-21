"""Direct search-domain and request-value units; all external I/O is doubled."""

from unittest.mock import AsyncMock, patch

import pytest


class TestTextSearchHighlightOverflowFallback:
    """text_search() must fall back to vector search on a highlight position overflow (#648)."""

    @pytest.mark.asyncio
    async def test_position_overflow_falls_back_to_vector_search(self):
        from open_notebook.domain import notebook as notebook_module

        overflow = RuntimeError(
            "A value can't be highlighted: position overflow: 2545 - len: 1965"
        )
        with (
            patch.object(
                notebook_module,
                "repo_query",
                new_callable=AsyncMock,
                side_effect=overflow,
            ),
            patch.object(
                notebook_module,
                "vector_search",
                new_callable=AsyncMock,
                return_value=[{"id": "source:1"}],
            ) as mock_vector,
        ):
            result = await notebook_module.text_search("hello", 10)

        assert result == [{"id": "source:1"}]
        mock_vector.assert_awaited_once_with("hello", 10, True, True, notebook_ids=None)

    @pytest.mark.asyncio
    async def test_position_overflow_raises_when_vector_also_fails(self):
        from open_notebook.domain import notebook as notebook_module
        from open_notebook.exceptions import DatabaseOperationError

        overflow = RuntimeError("position overflow: 1 - len: 0")
        with (
            patch.object(
                notebook_module,
                "repo_query",
                new_callable=AsyncMock,
                side_effect=overflow,
            ),
            patch.object(
                notebook_module,
                "vector_search",
                new_callable=AsyncMock,
                side_effect=Exception("no embedding model"),
            ),
        ):
            # When both search paths fail, surface the error rather than masking it
            # as an empty result set.
            with pytest.raises(DatabaseOperationError):
                await notebook_module.text_search("hello", 10)

    @pytest.mark.asyncio
    async def test_other_runtime_errors_still_raise(self):
        from open_notebook.domain import notebook as notebook_module
        from open_notebook.exceptions import DatabaseOperationError

        with patch.object(
            notebook_module,
            "repo_query",
            new_callable=AsyncMock,
            side_effect=RuntimeError("some other db failure"),
        ):
            with pytest.raises(DatabaseOperationError):
                await notebook_module.text_search("hello", 10)


class TestVectorSearchOrdering:
    """vector_search() must return results in descending similarity order (#1301)."""

    @pytest.mark.asyncio
    async def test_reorders_results_by_descending_similarity(self):
        from open_notebook.domain import notebook as notebook_module

        unordered = [
            {"id": "source:vehicle", "similarity": 0.353189},
            {"id": "source:medical", "similarity": 0.548259},
            {"id": "source:finance", "similarity": 0.389266},
        ]
        with (
            patch.object(
                notebook_module,
                "generate_embedding",
                create=True,
                new_callable=AsyncMock,
                return_value=[0.1, 0.2],
            ),
            patch(
                "open_notebook.utils.embedding.generate_embedding",
                new_callable=AsyncMock,
                return_value=[0.1, 0.2],
            ),
            patch.object(
                notebook_module,
                "repo_query",
                new_callable=AsyncMock,
                return_value=unordered,
            ),
        ):
            result = await notebook_module.vector_search(
                "Which document discusses examination of a person's eyesight?",
                10,
                True,
                False,
                0.1,
            )

        assert [item["id"] for item in result] == [
            "source:medical",
            "source:finance",
            "source:vehicle",
        ]
        assert [item["similarity"] for item in result] == [
            0.548259,
            0.389266,
            0.353189,
        ]

    @pytest.mark.asyncio
    async def test_tie_break_is_deterministic_by_id(self):
        from open_notebook.domain import notebook as notebook_module

        tied = [
            {"id": "source:b", "similarity": 0.5},
            {"id": "source:a", "similarity": 0.5},
            {"id": "source:c", "similarity": 0.4},
        ]
        with (
            patch(
                "open_notebook.utils.embedding.generate_embedding",
                new_callable=AsyncMock,
                return_value=[0.1],
            ),
            patch.object(
                notebook_module,
                "repo_query",
                new_callable=AsyncMock,
                return_value=tied,
            ),
        ):
            result = await notebook_module.vector_search("q", 3)

        assert [item["id"] for item in result] == [
            "source:a",
            "source:b",
            "source:c",
        ]


class TestResolveNotebookScope:
    """resolve_notebook_scope() validates ids before any search runs (#574, #87)."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize("bad_id", ["", "notebook:", "source:abc", "abc"])
    async def test_malformed_ids_raise_invalid_input(self, bad_id):
        from open_notebook.domain import notebook as notebook_module
        from open_notebook.exceptions import InvalidInputError

        with patch.object(
            notebook_module, "repo_query", new_callable=AsyncMock
        ) as mock_query:
            with pytest.raises(InvalidInputError):
                await notebook_module.resolve_notebook_scope([bad_id])
        mock_query.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_empty_scope_skips_the_database(self):
        from open_notebook.domain import notebook as notebook_module

        with patch.object(
            notebook_module, "repo_query", new_callable=AsyncMock
        ) as mock_query:
            assert await notebook_module.resolve_notebook_scope([]) == []
        mock_query.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_missing_notebooks_raise_not_found_listing_them(self):
        from open_notebook.domain import notebook as notebook_module
        from open_notebook.exceptions import NotFoundError

        with patch.object(
            notebook_module,
            "repo_query",
            new_callable=AsyncMock,
            return_value=[{"id": "notebook:a"}],
        ):
            with pytest.raises(NotFoundError, match="notebook:zzz"):
                await notebook_module.resolve_notebook_scope(
                    ["notebook:a", "notebook:zzz"]
                )

    @pytest.mark.asyncio
    async def test_record_id_rows_from_driver_match_request_strings(self):
        """The real driver returns RecordID objects, not strings (regression)."""
        from surrealdb import RecordID

        from open_notebook.domain import notebook as notebook_module

        with patch.object(
            notebook_module,
            "repo_query",
            new_callable=AsyncMock,
            return_value=[{"id": RecordID("notebook", "a")}],
        ):
            assert await notebook_module.resolve_notebook_scope(["notebook:a"]) == [
                "notebook:a"
            ]


class TestNotebookScopedSearchDomain:
    """text_search / vector_search bind the scope as record ids (#574, #87)."""

    @pytest.mark.asyncio
    async def test_text_search_binds_notebook_record_ids(self):
        from surrealdb import RecordID

        from open_notebook.domain import notebook as notebook_module

        with patch.object(
            notebook_module, "repo_query", new_callable=AsyncMock, return_value=[]
        ) as mock_query:
            await notebook_module.text_search(
                "hello", 10, notebook_ids=["notebook:a", "notebook:b"]
            )

        assert mock_query.await_args is not None

        query, params = mock_query.await_args.args
        assert "$notebook_ids" in query
        assert params["notebook_ids"] == [
            RecordID("notebook", "a"),
            RecordID("notebook", "b"),
        ]

    @pytest.mark.asyncio
    async def test_empty_scope_binds_none_for_global_search(self):
        from open_notebook.domain import notebook as notebook_module

        with patch.object(
            notebook_module, "repo_query", new_callable=AsyncMock, return_value=[]
        ) as mock_query:
            await notebook_module.text_search("hello", 10, notebook_ids=[])
            await notebook_module.text_search("hello", 10)

        for call in mock_query.await_args_list:
            assert call.args[1]["notebook_ids"] is None

    @pytest.mark.asyncio
    async def test_vector_search_binds_notebook_record_ids(self):
        from surrealdb import RecordID

        from open_notebook.domain import notebook as notebook_module

        with (
            patch(
                "open_notebook.utils.embedding.generate_embedding",
                new_callable=AsyncMock,
                return_value=[0.1],
            ),
            patch.object(
                notebook_module, "repo_query", new_callable=AsyncMock, return_value=[]
            ) as mock_query,
        ):
            await notebook_module.vector_search("q", 3, notebook_ids=["notebook:a"])

        assert mock_query.await_args is not None

        query, params = mock_query.await_args.args
        assert "$notebook_ids" in query
        assert params["notebook_ids"] == [RecordID("notebook", "a")]


class TestNotebookScopedSearchApi:
    def test_scope_merges_and_dedupes_single_and_list(self):
        from api.models import SearchRequest

        request = SearchRequest(
            query="x",
            notebook_id="notebook:a",
            notebook_ids=["notebook:b", "notebook:a"],
        )
        assert request.scope_notebook_ids == ["notebook:a", "notebook:b"]
        assert SearchRequest(query="x").scope_notebook_ids == []

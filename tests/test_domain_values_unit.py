"""
Unit tests for the open_notebook.domain module.

This test suite focuses on validation logic, business rules, and data structures
that can be tested without database mocking.
"""


import pytest
from pydantic import ValidationError

from open_notebook.ai.models import ModelManager
from open_notebook.domain.base import RecordModel
from open_notebook.domain.content_settings import ContentSettings
from open_notebook.domain.notebook import (
    Note,
)
from open_notebook.domain.transformation import Transformation
from open_notebook.exceptions import InvalidInputError
from open_notebook.podcasts.models import EpisodeProfile, SpeakerProfile

# ============================================================================
# TEST SUITE 1: RecordModel Singleton Pattern
# ============================================================================


class TestRecordModelSingleton:
    """Test suite for RecordModel singleton behavior."""

    def test_recordmodel_singleton_behavior(self):
        """Test that same instance is returned for same record_id."""

        class TestRecord(RecordModel):
            record_id = "test:singleton"
            value: int = 0

        # Clear any existing instance
        TestRecord.clear_instance()

        # Create first instance
        instance1 = TestRecord(value=42)
        assert instance1.value == 42

        # Create second instance - should return same object
        instance2 = TestRecord(value=99)
        assert instance1 is instance2
        assert instance2.value == 99  # Value was updated

        # Cleanup
        TestRecord.clear_instance()


class TestModelManager:
    """Test suite for ModelManager instance behavior."""

    def test_model_manager_instance_isolation(self):
        """Test that each ModelManager instance is independent (not a singleton)."""
        manager1 = ModelManager()
        manager2 = ModelManager()

        # Each instance should be independent (not a singleton)
        assert manager1 is not manager2
        assert id(manager1) != id(manager2)


class TestNoteDomain:
    """Test suite for Note validation."""

    def test_note_content_validation(self):
        """Test empty content is rejected."""
        # None content is allowed
        note = Note(title="Test", content=None)
        assert note.content is None

        # Non-empty content is valid
        note2 = Note(title="Test", content="Valid content")
        assert note2.content == "Valid content"

        # Empty string should raise error
        with pytest.raises(InvalidInputError, match="Note content cannot be empty"):
            Note(title="Test", content="")

        # Whitespace-only should raise error
        with pytest.raises(InvalidInputError, match="Note content cannot be empty"):
            Note(title="Test", content="   ")

    def test_note_content_for_embedding(self):
        """Test notes can hold content for embedding.

        Note: Embedding is now handled via command submission in Note.save(),
        not via needs_embedding() method. This test verifies basic content handling.
        """
        note = Note(title="Test", content="Test content")
        assert note.content == "Test content"

        # Test with None content - valid, no embedding will be submitted
        note2 = Note(title="Test", content=None)
        assert note2.content is None


class TestPodcastDomain:
    """Test suite for Podcast domain validation."""

    def test_speaker_profile_validation(self):
        """Test speaker profile validates count and required fields."""
        # Test invalid - no speakers
        with pytest.raises(ValidationError):
            SpeakerProfile(
                name="Test",
                speakers=[],
            )

        # Test invalid - too many speakers (> 4)
        with pytest.raises(ValidationError):
            SpeakerProfile(
                name="Test",
                speakers=[{"name": f"Speaker{i}"} for i in range(5)],
            )

        # Test invalid - missing required fields
        with pytest.raises(ValidationError):
            SpeakerProfile(
                name="Test",
                speakers=[
                    {"name": "Speaker 1"}
                ],  # Missing voice_id, backstory, personality
            )

        # Test valid - single speaker with all fields
        profile = SpeakerProfile(
            name="Test",
            speakers=[
                {
                    "name": "Host",
                    "voice_id": "voice123",
                    "backstory": "A friendly host",
                    "personality": "Enthusiastic and welcoming",
                }
            ],
        )
        assert len(profile.speakers) == 1
        assert profile.speakers[0]["name"] == "Host"


class TestTransformationDomain:
    """Test suite for Transformation domain model."""

    def test_transformation_creation(self):
        """Test transformation model creation."""
        transform = Transformation(
            name="summarize",
            title="Summarize Content",
            description="Creates a summary",
            prompt="Summarize the following text: {content}",
            apply_default=True,
        )

        assert transform.name == "summarize"
        assert transform.apply_default is True


class TestContentSettings:
    """Test suite for ContentSettings defaults."""

    def teardown_method(self):
        # ContentSettings is a RecordModel singleton; drop any instance these
        # tests created so a non-default value can't leak into other tests.
        ContentSettings.clear_instance()

    def test_content_settings_defaults(self):
        """Test ContentSettings has proper defaults."""
        settings = ContentSettings()

        assert settings.record_id == "open_notebook:content_settings"
        assert settings.default_content_processing_engine_doc == "auto"
        assert settings.default_embedding_option == "ask"
        assert settings.auto_delete_files == "yes"
        assert settings.youtube_preferred_languages is not None
        assert len(settings.youtube_preferred_languages) > 0

    def test_content_settings_accepts_crawl4ai_url_engine(self):
        """crawl4ai is a valid URL processing engine (content-core 2.x)."""
        settings = ContentSettings(default_content_processing_engine_url="crawl4ai")
        assert settings.default_content_processing_engine_url == "crawl4ai"

    def test_docling_ocr_defaults_on(self):
        """OCR is on by default (matches content-core's docling_ocr default)."""
        settings = ContentSettings()
        assert settings.docling_ocr is True
        assert ContentSettings(docling_ocr=False).docling_ocr is False

    def test_docling_formulas_defaults_off(self):
        """Formula extraction is off by default (matches content-core)."""
        settings = ContentSettings()
        assert settings.docling_formulas is False
        assert ContentSettings(docling_formulas=True).docling_formulas is True

    def test_docling_vision_defaults_off(self):
        """Image/chart vision is off by default (matches content-core)."""
        settings = ContentSettings()
        assert settings.docling_vision is False
        assert ContentSettings(docling_vision=True).docling_vision is True


class TestEpisodeProfile:
    """Test suite for EpisodeProfile validation."""

    def test_episode_profile_segment_validation(self):
        """Test segment count validation (3-20)."""
        # Test invalid - too few segments
        with pytest.raises(
            ValidationError, match="Number of segments must be between 3 and 20"
        ):
            EpisodeProfile(
                name="Test",
                speaker_config="default",
                default_briefing="Test briefing",
                num_segments=2,
            )

        # Test invalid - too many segments
        with pytest.raises(
            ValidationError, match="Number of segments must be between 3 and 20"
        ):
            EpisodeProfile(
                name="Test",
                speaker_config="default",
                default_briefing="Test briefing",
                num_segments=21,
            )

        # Test valid segment count
        profile = EpisodeProfile(
            name="Test",
            speaker_config="default",
            default_briefing="Test briefing",
            num_segments=5,
        )
        assert profile.num_segments == 5


class TestCredentialConfigBag:
    """Provider-specific extras (num_ctx) round-trip through the flexible
    `config` object instead of a dedicated SCHEMAFULL column."""

    def test_prepare_save_data_packs_num_ctx_into_config(self):
        from open_notebook.domain.credential import Credential

        cred = Credential(name="Local Ollama", provider="ollama", num_ctx=16384)
        data = cred._prepare_save_data()

        assert data["config"] == {"num_ctx": 16384}
        assert "num_ctx" not in data  # not a top-level column anymore

    def test_prepare_save_data_config_none_when_no_extras(self):
        from open_notebook.domain.credential import Credential

        cred = Credential(name="OpenAI", provider="openai")
        data = cred._prepare_save_data()

        assert data["config"] is None
        assert "num_ctx" not in data

    def test_db_row_with_config_lifts_num_ctx_to_top_level(self):
        from open_notebook.domain.credential import Credential

        # Simulates a row read back from the DB
        cred = Credential(
            name="Local Ollama",
            provider="ollama",
            config={"num_ctx": 8192},
        )

        assert cred.num_ctx == 8192  # mirrored from config onto the convenience field

    def test_num_ctx_round_trips_through_save_and_load(self):
        from open_notebook.domain.credential import Credential

        original = Credential(name="Local Ollama", provider="ollama", num_ctx=4096)
        persisted = original._prepare_save_data()
        # Rebuild from the persisted shape (as the DB would return it)
        reloaded = Credential(
            name=persisted["name"],
            provider=persisted["provider"],
            config=persisted["config"],
        )

        assert reloaded.num_ctx == 4096
        assert reloaded.to_esperanto_config()["num_ctx"] == 4096

    def test_null_config_loads_without_extras(self):
        from open_notebook.domain.credential import Credential

        cred = Credential(name="OpenAI", provider="openai", config=None)

        assert cred.num_ctx is None
        assert cred.config is None
        assert cred._prepare_save_data()["config"] is None

    def test_unmapped_config_keys_are_preserved_on_save(self):
        from open_notebook.domain.credential import Credential

        # A newer version may have written config keys this model doesn't map.
        # They must survive a load/save round-trip rather than be clobbered
        # (repo_update MERGE replaces the whole config object).
        cred = Credential(
            name="Local Ollama",
            provider="ollama",
            config={"num_ctx": 8192, "future_option": "keep-me"},
        )
        assert cred.num_ctx == 8192

        data = cred._prepare_save_data()
        assert data["config"] == {"num_ctx": 8192, "future_option": "keep-me"}

    def test_clearing_num_ctx_keeps_other_config_keys(self):
        from open_notebook.domain.credential import Credential

        cred = Credential(
            name="Local Ollama",
            provider="ollama",
            config={"num_ctx": 8192, "future_option": "keep-me"},
        )
        cred.num_ctx = None  # user clears the override

        data = cred._prepare_save_data()
        assert data["config"] == {"future_option": "keep-me"}

    def test_mirrored_num_ctx_is_validated_as_int(self):
        from open_notebook.domain.credential import Credential

        # A value coming from the flexible config bag is routed through normal
        # Pydantic field validation, not set raw.
        cred = Credential(
            name="Local Ollama", provider="ollama", config={"num_ctx": "8192"}
        )
        assert cred.num_ctx == 8192
        assert isinstance(cred.num_ctx, int)

        # A non-coercible value is rejected rather than silently flowing through.
        with pytest.raises(ValidationError):
            Credential(
                name="Local Ollama", provider="ollama", config={"num_ctx": "not-an-int"}
            )

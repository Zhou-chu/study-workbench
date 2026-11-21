# RecordModel class field access

The complete e10f7d8 regression exposed four first-party Pydantic 2.11
instance-level `model_fields` deprecation warnings. Access now uses the concrete
class via `type(self).model_fields`; persistence payloads and query behavior are
unchanged. Two direct logical-unit regressions failed on that specific warning
before the change (warnings promoted to errors), then passed with class access.
They preserve inherited fields, omit ClassVar metadata, retain nullable values,
and verify both empty and populated stored responses. Repository I/O is doubled.
The singleton instance dictionary is isolated and restored by monkeypatch.

First post-fix run exposed a test expectation mistake: Surreal RecordID renders a
hyphenated key with quoting. The assertion now compares the actual typed RecordID
value rather than an incorrect display string. Final targeted regression: 49 passed,
one remaining third-party Pydantic warning. Production serialization was not changed.

The earlier complete mixed report still describes e10f7d8, not this later change.
No production data, migration, deployment or encryption setting was changed.

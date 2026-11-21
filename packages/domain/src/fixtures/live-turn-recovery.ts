// Fully synthetic recovery contract fixture; no live identifiers, timestamps or usage.
export default {
  "workspace": {
    "schema_version": "workspace-view-v1",
    "notebook": {
      "id": "notebook:synthetic00000000012",
      "name": "Synthetic name"
    },
    "jobs": [
      {
        "operation": "extract_evidence",
        "job_id": "job_000000000000000000000000000000000000000000000000000000000000000a",
        "notebook_id": "notebook:synthetic00000000012",
        "idempotency_key": "00000000-0000-4000-8000-000000000002",
        "state": "succeeded",
        "submission_state": "not_submitted",
        "result": {
          "success": true,
          "warnings": [],
          "source_version_id": "sv_0000000000000000000000000000000e",
          "extraction_id": "ex_00000000000000000000000000000007",
          "status": "ready",
          "evidence_count": 40
        },
        "source_id": "source:synthetic00000000013",
        "source_version_id": "sv_0000000000000000000000000000000e",
        "attempts": 0,
        "created_at": "2000-01-01T00:00:00Z",
        "started_at": "2000-01-01T00:00:01Z",
        "completed_at": "2000-01-01T00:00:02Z"
      },
      {
        "operation": "chat",
        "job_id": "job_0000000000000000000000000000000000000000000000000000000000000009",
        "turn_id": "turn_0000000000000000000000000000000000000000000000000000000000000010",
        "notebook_id": "notebook:synthetic00000000012",
        "chat_session_id": "v1_notebook:synthetic00000000012",
        "idempotency_key": "00000000-0000-4000-8000-000000000001",
        "state": "succeeded",
        "submission_state": "confirmed",
        "request_snapshot": {
          "notebook_id": "notebook:synthetic00000000012",
          "engine": "independent",
          "message": "Synthetic message",
          "selection_origin": "local",
          "source_version_ids": [
            "sv_0000000000000000000000000000000f"
          ],
          "remote_source_ids": [],
          "idempotency_key": "00000000-0000-4000-8000-000000000001",
          "task": "question",
          "retrieval_mode": "lexical"
        },
        "result": {
          "turn_id": "turn_0000000000000000000000000000000000000000000000000000000000000010",
          "notebook_id": "notebook:synthetic00000000012",
          "chat_session_id": "v1_notebook:synthetic00000000012",
          "engine": "independent",
          "message": "Synthetic message",
          "idempotency_key": "00000000-0000-4000-8000-000000000001",
          "status": "succeeded",
          "generation_status": "succeeded",
          "answer": "Synthetic answer",
          "scope_snapshot": {
            "engine": "independent",
            "selection_origin": "local",
            "source_version_ids": [
              "sv_0000000000000000000000000000000f"
            ],
            "remote_source_ids": [],
            "scope_hash": "0000000000000000000000000000000000000000000000000000000000000003",
            "mapping_version": 1
          },
          "citations": [
            {
              "citation_id": "c1",
              "kind": "local_evidence",
              "quote": "Synthetic quote",
              "reference_validity": "verified",
              "source_version_id": "sv_0000000000000000000000000000000f",
              "evidence_id": "ev_00000000000000000000000000000005",
              "source_title": "Synthetic source_title",
              "locator": {
                "page_index": 2,
                "block_id": "page_0002",
                "start_offset": 0,
                "end_offset": 16
              }
            }
          ],
          "retrieval_request": {
            "retrieval_mode": "lexical"
          },
          "retrieval": {
            "requested_method": "lexical",
            "retrieval_method": "lexical",
            "indexed_version_count": 0,
            "selected_version_count": 1,
            "warnings": []
          },
          "coverage": {
            "selected_source_count": 1,
            "retrieved_source_count": 1,
            "evidence_count": 3
          },
          "warnings": [],
          "evidence_ids": [
            "ev_00000000000000000000000000000005",
            "ev_00000000000000000000000000000006",
            "ev_00000000000000000000000000000004"
          ],
          "created_at": "2000-01-01T00:00:05Z",
          "completed_at": "2000-01-01T00:00:06Z",
          "scope_hash": "0000000000000000000000000000000000000000000000000000000000000003",
          "grounding_status": "references_verified",
          "model_id": "model:synthetic00000000011",
          "pipeline_version": "1",
          "budget": {
            "context_tokens": 16,
            "output_tokens": 5,
            "estimated_input_tokens": 16,
            "estimator": "utf8_byte_upper_bound",
            "retrieved_evidence_count": 3,
            "included_evidence_count": 3
          }
        },
        "attempts": 1,
        "created_at": "2000-01-01T00:00:03Z",
        "started_at": "2000-01-01T00:00:04Z",
        "completed_at": "2000-01-01T00:00:07Z"
      }
    ],
    "sources": [],
    "turns": [],
    "notes": [],
    "link": null,
    "selection": null,
    "legacy_history": []
  },
  "history": [
    {
      "answer": "Synthetic answer",
      "budget": {
        "context_tokens": 16,
        "estimated_input_tokens": 16,
        "estimator": "utf8_byte_upper_bound",
        "included_evidence_count": 3,
        "output_tokens": 5,
        "retrieved_evidence_count": 3
      },
      "chat_session_id": "v1_notebook:synthetic00000000012",
      "citations": [
        {
          "citation_id": "c1",
          "evidence_id": "ev_00000000000000000000000000000005",
          "kind": "local_evidence",
          "locator": {
            "block_id": "page_0002",
            "end_offset": 16,
            "page_index": 2,
            "start_offset": 0
          },
          "quote": "Synthetic quote",
          "reference_validity": "verified",
          "source_title": "Synthetic source_title",
          "source_version_id": "sv_0000000000000000000000000000000f"
        }
      ],
      "completed_at": "2000-01-01T00:00:06Z",
      "coverage": {
        "evidence_count": 3,
        "retrieved_source_count": 1,
        "selected_source_count": 1
      },
      "created_at": "2000-01-01T00:00:05Z",
      "engine": "independent",
      "evidence_ids": [
        "ev_00000000000000000000000000000005",
        "ev_00000000000000000000000000000006",
        "ev_00000000000000000000000000000004"
      ],
      "generation_status": "succeeded",
      "grounding_status": "references_verified",
      "idempotency_key": "00000000-0000-4000-8000-000000000001",
      "message": "Synthetic message",
      "model_id": "model:synthetic00000000011",
      "notebook_id": "notebook:synthetic00000000012",
      "pipeline_version": "1",
      "request_hash": "0000000000000000000000000000000000000000000000000000000000000008",
      "retrieval": {
        "indexed_version_count": 0,
        "requested_method": "lexical",
        "retrieval_method": "lexical",
        "selected_version_count": 1,
        "warnings": []
      },
      "retrieval_request": {
        "retrieval_mode": "lexical"
      },
      "scope_hash": "0000000000000000000000000000000000000000000000000000000000000003",
      "scope_snapshot": {
        "engine": "independent",
        "mapping_version": 1,
        "remote_source_ids": [],
        "scope_hash": "0000000000000000000000000000000000000000000000000000000000000003",
        "selection_origin": "local",
        "source_version_ids": [
          "sv_0000000000000000000000000000000f"
        ]
      },
      "status": "succeeded",
      "turn_id": "turn_0000000000000000000000000000000000000000000000000000000000000010",
      "usage": {
        "input_token_details": {
          "cache_read": 0
        },
        "input_tokens": 10,
        "output_token_details": {},
        "output_tokens": 5,
        "total_tokens": 15
      },
      "warnings": []
    }
  ]
};

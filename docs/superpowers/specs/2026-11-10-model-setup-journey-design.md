# Model setup journey repair

## Intent and scope
The user requests continuous product red-team repair and has reported that saving a DeepSeek API configuration appears ineffective. Make the existing configuration path understandable without treating a saved credential as an externally verified working model. This is a scoped UX correction, not permission to make provider calls or change existing defaults automatically.

## Approach
Keep the existing configuration store, captured confirmations and mutation guards. Add a compact read-only setup overview and precise next-step guidance beside saved configurations. Link to existing registration/default controls, and show which saved configuration each registered model uses. A wizard that automatically discovers/registers/selects a model is rejected: it would make unrequested provider requests and consequential choices. A static help paragraph alone is insufficient because it would not explain current state.

## Required behavior
- Distinguish credential saved, model registered, current chat default, and external service validation. Never infer connectivity from a credential or a nonempty default ID.
- Show the currently selected chat provider/model. Explain that saving another credential and auto-assignment do not replace an existing default.
- For a usable credential with no registered models, offer a clear next step through the existing explicit Discover/registration flow, not an automatic request.
- Show a model's linked credential name when known, or explicit unbound/unknown state, without keys, secret URLs or raw payloads.
- Missing/error metadata stays unknown/loading, never falsely shows zero configured or ready.
- Preserve every existing control, confirmation, unknown-write fence, encryption gate, and private-input lifecycle.
- English and Chinese copy, quiet monochrome layout. Real provider/browser acceptance remains separately blocked; synthetic UI evidence cannot close it.

## Non-goals
No backend dedup/rebinding change, automatic default selection, credential/key persistence, real provider calls, deployment, or edits to the frozen9ee810 checkout. NotebookShell return repairs belong to the separate audit worker.

## Authoritative review reference
The complete product review specification is https://chatgpt.com/space/page_48a624e1d6908191887f55de4294d2d7 (read in full). Relevant requirements are CFG01–08, J02–04 and J12. Field entry, saved configuration, service connectivity, target-model invocation, and actual task use are distinct facts. Derived UI readiness must not imply any of the latter three. Existing current test receipts must not be contradicted by a blanket permanent “never tested” label. Use P0/P1/P2 only for delivery priority and S0/S1/S2/S3 for defect severity. Unsaved draft persistence after reload is not promised by this specification.

Visual/interaction verification must include 390, 768, 1024, 1440 CSS widths, applicable light/dark states, 200% zoom/text scaling and keyboard interaction; mark any mobile soft-keyboard or real-content gap as NOT_RUN rather than substituting desktop emulation.

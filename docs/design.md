# Skill Capsule Design

## Live design

The current system is a deterministic file-backed runtime:

- `capsules/` declare workflow bundles
- `atoms/` declare addressable capability units
- `hooks/hooks.registry.json` declares the only executable hooks
- the runtime composes a compact LLM-facing capsule from matched atoms

## What the runtime currently does

1. Normalize a task from raw text or `task.json`.
2. Classify task type, risk, tags, and negative intents.
3. Match atoms and pull their parent capsules into the active set.
4. Resolve dependencies and conflicts.
5. Plan hooks by phase and order them by declared hook dependencies.
6. Execute `before_render` hooks with registry allowlisting, timeout limits, permission checks, and guarded template substitution.
7. Enforce command-policy allowlisting and local hook-script path constraints before any hook process starts.
8. Launch hook processes with a minimized host environment and only explicit config-allowlisted passthrough variables.
9. Support an enforced container hook runner mode that converts validated hook commands into container invocations with workspace mounts, env injection, and resource flags.
10. Optionally execute an explicit preparation stage for `before_action` hooks and emit a readiness receipt.
11. Select `S/O/X` render levels under the active token budget.
12. Emit a compiled capsule and activation receipt.
13. Persist compose, prepare, and verify artifacts to `.skillcapsule/compiled/` through atomic writes, and roll back new artifacts if index persistence fails.
14. Maintain a lightweight artifact index so downstream consumers can query recent receipts by kind, run ID, parent artifact ID, atom, status, task type, and recency, and ask for latest, latest-successful, or latest-failed artifacts directly.
15. Correlate compose, prepare, and verify receipts from one workflow through a shared run ID and lineage query.
16. Preserve branch structure inside a run with parent artifact links so retries and follow-up verification steps can be traced deterministically.
17. Enforce artifact retention policy with per-kind and total caps to keep compiled state bounded.
18. Provide resume hints from any artifact so a caller can continue the lifecycle with preserved run and parent linkage.
19. Emit JSONL audit events for runtime actions and normalize thrown failures into stable error envelopes.
20. Summarize artifact history by kind, status, and task type for operational inspection.
21. Validate deployment config, hook registry integrity, local hook script targets, required host executables, enforced container-runner prerequisites, and image-tag hygiene at startup, while still exposing degraded HTTP diagnostics when startup is not ready.
22. Support an optional real-container integration test path so enforced container mode can be exercised against Docker in CI or staging.

## What is intentionally not claimed yet

- No full DAG hook scheduler
- No container-backed hook isolation
- No automatic execution of `before_action` hooks during `compose`
- No hot-path meta evolution

Those remain future work and should stay documented as such.

## Patch model

Supported low-risk patch operations:

- `replace_render`
- `add_trigger_keyword`
- `remove_trigger_keyword`
- `tighten_activation`
- `add_example`
- `deprecate_example`
- `append_evidence`
- `change_status`

Hook edits are validation failures. Valid patches can be applied through the CLI, which updates the target atom, bumps the patch version, and archives the patch into `.skillcapsule/patches/accepted` when it originated from `pending/`.

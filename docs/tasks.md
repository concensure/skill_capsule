# Skill Capsule - Task Document

Three goals: retain project shape, no token bloat, reliable governance.

---

## Claude Skill parity - capsule render phase

The capsule render phase has six steps. Coverage status per step:

### Step 1 - Parse capsule atom
**Status: complete.**
Atom matching and capsule selection are fully implemented. The runtime loads atoms from `.skillcapsule/atoms/`, matches by trigger keywords and task type, resolves dependencies and conflicts, and pulls parent capsules into the active set.

### Step 2 - Resolve variables
**Status: partial.**

| Variable | Status |
|---|---|
| `${capsule_dir}` | Resolved - mapped to `config.capsule_dir` at runtime init |
| `${project_root}` | Resolved - `process.cwd()` at runtime init |
| `${session_id}` | Missing - no session identity is threaded through the runtime |
| `{{HOOK_RESULTS}}` | Resolved - hook summaries injected into render templates |
| `{{ALLOWED_PATHS}}` | Resolved - passed via task payload |

**Task:** Add `session_id` to `TaskPayload` and thread it through as a resolvable template variable. Default to the compose `runId` if not supplied by the caller.

### Step 3 - Parse arguments
**Status: complete.**
Task arguments are carried by `TaskPayload`: description, budget, task_type, allowed_paths, readonly_paths, changed_files, remote, branch, intents, run_id, parent_artifact_id.

### Step 4 - Apply approval policy
**Status: partial.**

Approval is declared per hook via `requires_user_approval: true`. When this flag is set, the hook surfaces as `SKIP` in results rather than executing. The calling LLM or human operator must re-invoke after granting approval.

What is missing: the approval gate is not checked at the compose level. An atom with `activation_mode: approval` can be composed into a capsule without any gate being applied at output time.

**Task:** During `compose`, check `activation_mode` on matched atoms. For atoms with `activation_mode: approval`, include an explicit approval notice in the compiled capsule output and mark the receipt with `requires_approval: true`. This keeps the gate visible without blocking compose.

### Step 5 - Inject dynamic context
**Status: partial.**

Hook results are injected into render templates via `{{HOOK_RESULTS}}` substitution. This covers the main dynamic context path.

What is missing: no structured tool plan is emitted alongside the compiled capsule. The current output is a text render card plus a JSON receipt. A tool plan (which MCP tools to call, in what order, with what inputs) is not generated.

**Task:** Add an optional `tool_plan` field to the `ComposeResult`. Populate it from the hook plan - each planned hook with its phase, permission level, and approval requirement becomes a tool plan entry. This is additive and does not change the existing compiled capsule format.

### Step 6 - Emit final prompt / tool plan
**Status: mostly complete.**

The compiled capsule is the final prompt output. The activation receipt captures the full execution plan. The tool plan (Step 5) is the missing piece.

**Task:** Emit `tool_plan` as a structured array in the compose artifact:

```json
{
  "tool_plan": [
    { "hook": "hook.git.status", "phase": "before_render", "mode": "inspect", "approval": false },
    { "hook": "hook.secrets.scan", "phase": "before_action", "mode": "inspect", "approval": false },
    { "hook": "hook.github.push", "phase": "after_action", "mode": "approval", "approval": true }
  ]
}
```

This makes Skill Capsule a drop-in for Claude Skill tool-plan emission without changing the hot path.

---

## Evolution capability tasks

These are ordered by the refined implementation sequence in `docs/evolution_refined.md`.

### Evo-1 - Outcome instrumentation for reliable evidence
**Status: not started.**
Extend outcome recording so the validator can rely on explicit evidence instead of inference. Ensure outcomes can consistently capture:

- activation accepted / rejected
- matched atoms
- expected atoms when available
- optional mutation decision metadata

This is the prerequisite for trustworthy evolution metrics. Missing data should remain representable as `null`, not fabricated.

### Evo-2 - Structured governance metrics in index output
**Status: not started.**
Compute per-atom metrics from compiled artifacts and outcomes during `skillcap index`. Write machine-readable results to `.skillcapsule/metrics/governance.json`, then render a human summary into `INDEX.md`.

Initial metrics:

- token efficiency
- hook pass rate
- activation accept rate

Deferred metric:

- retrieval precision, only when `expected_atoms` capture is reliable enough

### Evo-3 - Guardrail-based ratchet in patch validator
**Status: not started.**
Extend `patch validate` to read structured governance metrics and apply:

- hard invariants
- per-metric regression guardrails
- evidence sufficiency checks

Validator result should return one of `auto_approvable`, `needs_human_approval`, or `rejected`. A summary score may be included for reporting, but must not be the sole approval gate.

Depends on: Evo-2.

### Evo-4 - Patch risk classes
**Status: not started.**
Classify supported patch operations by approval risk so the validator can apply stricter defaults to reach-broadening changes.

Suggested default mapping:

- Low risk: `add_example`, `deprecate_example`, `append_evidence`, `tighten_activation`, `remove_trigger_keyword`
- Medium risk: `replace_render`, `add_trigger_keyword`
- High risk: any future operation that broadens scope or edits policy/hook behavior

Depends on: Evo-3.

### Evo-5 - Evolution memory in outcome schema
**Status: not started.**
Add optional `mutation_record` field to outcome JSON. Schema remains backward-compatible. Record:

- `patch_id`
- `mutation`
- `decision`
- `decision_mode`
- `scorecard_before`
- `scorecard_after`
- `evidence_run_ids`

Independent of Evo-2 through Evo-4, but becomes more useful once they land.

### Evo-6 - Wire meta.propose.composite to outcome history
**Status: not started.**
Implement the `hook.meta.analyze_patterns` script so it reads `.skillcapsule/outcomes/` and artifact history, then emits evidence-backed patch proposals to `.skillcapsule/patches/pending/`.

The hook should propose changes conservatively:

- frequent false positives -> consider `remove_trigger_keyword` or `tighten_activation`
- frequent misses with strong evidence -> consider `add_trigger_keyword`
- token-heavy renders with weak utility -> consider `replace_render`

Depends on: Evo-2 and Evo-5.

### Evo-7 - Retrieval precision as staged capability
**Status: future work.**
Once `expected_atoms` capture is trustworthy, add retrieval precision to governance guardrails and reporting. Do not block earlier evolution work on this metric.

### Evo-8 - AST validation hook for atom source files
**Status: future work.**
A hook that parses atom JSON files for schema validity beyond what `patch validate` checks. Depends on finalizing the atom schema as a JSON Schema document. Listed in `docs/design.md` under remaining architecture work.

---

## Remaining architecture tasks (from design.md)

These are pre-existing items, listed here for single-source tracking.

| Task | Status |
|---|---|
| Hook DAG scheduler (dependencies across phases) | Not started |
| Container-backed isolation for non-read-only hooks | Not started |
| Auto-execute `before_action` hooks during `compose` | Not started |
| Hot-path meta evolution | Explicitly out of scope |

---

## Completed baseline

The following capabilities are complete and not tracked as tasks:

- Capsule and atom registry loading
- Task classification, atom matching, dependency and conflict resolution
- Hook planning, phase ordering, dependency-aware execution
- Hook allowlisting, permission enforcement, timeout, and output summarization
- S/O/X render selection under token budget
- Compile, prepare, and verify artifact lifecycle with run ID and lineage
- Artifact index queries: kind, run ID, parent artifact ID, atom, status, task type, latest/successful/failed
- Retention pruning
- Patch model: validate, apply, archive
- Outcome recording
- CIF.md and INDEX.md generation via `skillcap index`
- MCP wrapper for all runtime operations
- JSONL audit events and structured error envelopes
- Startup validation and HTTP diagnostics

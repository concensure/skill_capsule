# Skill Capsule - Task Document

Primary goals:

- preserve lightweight atom/capsule shape
- add deterministic capability contracts via LOCS-Capsule Profile v1
- keep retrieval token cost low with progressive reveal
- enforce governance and auditability without metadata bloat

---

## Integration backlog (LOCS + Skill Capsule)

### T1 - Add LOCS-Capsule Profile v1 schema support
**Status: completed**
Implement additive Level 1 capability metadata in atom schema and validation.

Deliverables:

- optional top-level `capability_id`
- optional `locs_capsule` object with required/optional fields from `docs/design.md`
- schema-level exclusion of heavy full-LOCS requirements for Level 1 atoms

### T2 - Capability-level validation rules
**Status: completed**
Add deterministic validators for governance contract completeness.

Validation must fail when:

- executable atom has no `approval_policy`
- high-risk atom has no `audit_level`
- swappable atom has no `capability_id`
- dependencies unresolved
- `risk_level` conflicts with `side_effects`

Implementation notes:

- schema parsing must happen before governance validation
- top-level `capability_id` and `locs_capsule.capability_id` must not diverge
- under-classified risk versus side-effect declarations are hard failures, not advisory warnings

### T3 - Upgrade `skillcap index` for contract routing
**Status: completed**
Extend index generation to:

- generate `.skillcapsule/CIF.md` from trigger metadata
- include capability routing fields (`capability_id`, risk, group, mode)
- include `compatible_atoms` derived from `swappable_atom_group`
- validate capability contracts and dependencies during indexing
- keep CIF as generated-only artifact (no manual edits)

Implementation notes:

- the CLI must call the shared TypeScript indexer instead of reimplementing CIF generation inline
- contract validation results must be visible in the generated artifact and process exit behavior
- output ordering must be deterministic across runs

### T4 - Add `skillcap inspect <capability_id>`
**Status: completed**
Command output:

- compatible atoms for the capability
- risk level and approval policy expectations
- audit level and success evidence expectations
- incompatibility reasons per candidate atom

Implemented behavior:

- shared runtime-backed capability inspection (`inspectCapability`) powers the CLI command
- per-atom output includes contract/governance validity plus rule-level violations and warnings
- inspection remains deterministic and contract-centric rather than recomputing ad hoc CLI views

### T5 - Add `skillcap select <capability_id>`
**Status: completed**
Implement deterministic atom selection by:

- capability match
- swappable group membership
- project compatibility constraints
- governance eligibility

Selection output includes selected atom + deterministic rejection reasons for non-selected candidates.

Implemented behavior:

- selection is now runtime-backed (`selectCapability`) rather than CLI-local logic
- candidates are ranked deterministically by eligibility, compatibility score, matched constraints, then atom id
- output includes `eligible`, `selected`, `governance_valid`, and explicit `rejection_reasons`
- when no candidate satisfies project constraints, the command returns no selected atom instead of silently choosing an incompatible one

### T6 - Add `skillcap audit <atom_id>`
**Status: completed**
Implement capability-aware evidence audit.

Checks:

- execution evidence (`success_evidence`)
- approval compliance
- dependency integrity
- contract compliance
- unexpected file changes
- exit status
- optional AST validation for code-edit atoms

Implemented behavior:

- shared runtime-backed audit (`auditAtom`) powers the CLI command
- audit reports include deterministic check records for contract compliance, dependency integrity, execution evidence, approval compliance, unexpected file changes, and exit status
- evidence is inferred from the latest prepare/verify artifacts and hook outcomes without introducing a database or heavyweight audit store
- approval-sensitive atoms surface explicit warnings when approval receipts are not yet modeled in compiled artifacts

### T7 - Progressive reveal enforcement
**Status: completed**
Apply strict load-order discipline in runtime:

1. CIF
2. capability contract
3. selected atom metadata
4. supporting scripts/files only if execution is required
5. optional temporal lookup only when risk/evidence gates require

Add guardrails that block full-registry/full-history preload in default flows.

Implemented behavior:

- `skillcap index` now emits `.skillcapsule/routing.manifest.json` as a compact routing summary alongside `CIF.md`
- runtime routing flows (`inspect`, `select`, `match`, `compose`) resolve candidates from the manifest first instead of eagerly parsing the full atom registry
- full atom JSON is hydrated only for the selected candidate set and its dependency closure
- direct atom execution paths (`prepare`, `verify`, `activate`, `audit`) still load only the addressed atom plus dependency closure rather than scanning the whole registry
- compose now fails with an explicit routing-index error when the generated manifest is missing instead of silently falling back to a full-registry preload

### T8 - Capability level classification
**Status: completed**
Implement explicit Level 0/1/2 classification and lightest-sufficient selection policy.

- Level 0: simple atom (no LOCS metadata)
- Level 1: LOCS-Capsule profile
- Level 2: full LOCS module

Implemented behavior:

- atoms now support explicit `locs_level` plus optional `locs_module_ref` for Level 2 routing
- shipped capability-aware atoms are marked `locs_level: 1` instead of relying only on implicit inference
- validators enforce Level 0/1/2 consistency, including `LEVEL2_REQUIRES_MODULE_REF` and `LEVEL2_REQUIRES_CAPABILITY_ID`
- runtime inspection, selection, and audit outputs expose `capability_level`
- capability selection now prefers the lightest sufficient eligible candidate before compatibility tie-breakers

### T9 - External temporal hook integration
**Status: completed**
Integrate `skillcap history` and `skillcap evolve` with external TimeTrace service.

Rules:

- atoms keep only temporal hooks (`temporal_tracking`, `temporal_scope`)
- no mutation/evolution/audit history persisted in atom JSON
- temporal retrieval is targeted and demand-driven

Implemented behavior:

- `skillcap` now integrates with external `TimeTrace` through a narrow CLI adapter instead of linking against TimeTrace internals
- integration resolves a built `tt` binary plus `.timetrace` workspace explicitly; missing workspace/binary now fails with actionable runtime errors instead of silent empty results
- `skillcapsule.config.json` may declare temporal settings (`workspace_dir`, `project_dir`, `binary`, `binary_args`, `allow_cargo_run`) so the unfinished TimeTrace project can evolve independently
- history/evolution queries remain demand-driven and capability-scoped; no temporal state is copied into atom JSON or normal compose/index context

### T10 - Add `skillcap evolve <capability_id>`
**Status: completed**
Implement comparative historical analysis with promotion/demotion guidance.

Outputs:

- evidence-backed trend summary
- capability-level recommendation (stay/promote/demote)
- confidence gating based on verified evidence quality

Implemented behavior:

- `skillcap evolve` now queries `tt compare --format json` and returns structured trend stats
- the runtime derives a conservative `promote` / `stay` / `demote` recommendation from approval rate, rollback presence, evidence quality, and TimeTrace confidence
- output includes `confidence_gate`, reasoning lines, and declared temporal scopes from current capability atoms
- recommendation logic stays in `skill_capsule`; TimeTrace remains the evidence source rather than the policy owner

### T11 - Add `skillcap history <capability_id>`
**Status: completed**
Implement targeted temporal lookup through TimeTrace with truth-priority sorting:

- verified > unverified
- approved > unapproved
- evidence-backed > inferred
- stable > recent

Recency alone must not rank as truth.

Implemented behavior:

- `skillcap history` now queries `tt history --capability-id --format json`
- results preserve TimeTrace truth-priority ordering and are surfaced as structured event payloads
- optional `--scope` is validated against declared `temporal_scope` values and reported as advisory because current TimeTrace CLI still returns capability-wide history
- missing TimeTrace setup now fails explicitly instead of pretending no history exists

### T12 - Token-efficiency discipline checks
**Status: completed**
Added `Indexer.checkTokenEfficiency(atoms)` running 5 checks: `OVERSIZED_CONTRACT_PAYLOAD` (contract JSON > 2 048 bytes), `TOO_MANY_EVIDENCE_ITEMS` (success_evidence > 10), `COMPATIBILITY_BLOAT` (compatible_atoms > 20), `TEMPORAL_SCOPE_WITHOUT_TRACKING`, `DUPLICATE_METADATA_FIELD`. Results written to `metrics/token_efficiency.json`. Violations surface in `indexSkillCapsule` error and warning arrays. Types `TokenEfficiencyViolation` and `TokenEfficiencyReport` added to `types.ts`.

### T13 - Opt-in temporal write-back
**Status: completed**
Emit capability selection and audit receipts into external TimeTrace without making TimeTrace availability a hard runtime dependency for core routing.

Implemented behavior:

- `skillcapsule.config.json` now supports `temporal.record_selection_events` and `temporal.record_audit_receipts`
- `selectCapability` records `tt record selection` when enabled and an atom is successfully selected
- `auditAtom` records `tt record audit` when enabled and the atom resolves to a capability contract
- TimeTrace write failures are returned as `temporal_warnings` on selection/audit results instead of breaking the primary command path
- write-back continues to use the same resolved `tt` binary and `.timetrace` workspace boundary as `history` and `evolve`

### T14 - Golden contract regression pack
**Status: completed**
Add release-grade golden checks for generated routing artifacts and CLI JSON contracts so drift is caught explicitly.

Implemented behavior:

- `test/golden-contracts.test.js` now validates exact generated CIF text from the shared indexer
- routing manifest structure is checked through a compact golden summary fixture rather than a huge raw snapshot
- CLI JSON contracts for `inspect`, `select`, and `doctor` are pinned through fixtures, with doctor output normalized for dynamic paths
- these tests are strict enough to catch accidental routing/diagnostic drift while staying portable across temp workspaces

### T15 - INDEX/report module extraction
**Status: completed**
Reduce `skillcap index` CLI complexity by extracting deterministic INDEX/governance report logic into a typed module.

Implemented behavior:

- `src/index-report.ts` now owns governance metric derivation, outcome loading, and `INDEX.md` rendering
- `bin/skillcap.js` keeps `index` as orchestration only: compile registry, load runtime state, call report helpers, write artifacts
- focused coverage in `test/index-report.test.js` validates INDEX rendering and governance metric computation directly
- existing CLI/indexer tests continue to cover malformed-profile and contract-failure behavior end to end

---

## Existing tasks retained

The following remain valid and are not superseded:

- session variable threading in compose templates
- compose-level visibility for `activation_mode: approval`
- optional structured `tool_plan` emission
- evolution roadmap items in `docs/evolution_refined.md`
- hook DAG scheduler and container isolation follow-up

---

## Completion criteria

Integration is complete when this statement is operationally true:

"The agent uses LOCS to understand stable capability contracts, then uses Skill Capsule atoms as interchangeable operational implementations."

Acceptance signals:

- deterministic capability routing from CIF
- compatibility-aware swappable atom selection
- measurable evidence audits
- governance policy enforcement failures are explicit and testable
- temporal intelligence is externally queried, not inlined into capsules
- no significant token bloat in default compose/index paths

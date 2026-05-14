# Skill Capsule Architecture

## Core model

Skill Capsule now uses a two-layer contract:

- LOCS is the capability contract layer.
- Skill Capsule atoms are the executable implementation layer.

This keeps routing deterministic and auditable while preserving lightweight atom files and low-token retrieval.

## Architecture layers

1. Intent routing layer (`.skillcapsule/CIF.md`)
   - Generated index from atom trigger metadata.
   - Maps compact intent terms to `capability_id`, risk, swap group, and mode.
2. Capability contract layer (LOCS-Capsule Profile v1)
   - Stable capability invariants used for planning and governance.
   - Lives as lightweight metadata under atom-local `locs_capsule` (Level 1) or full LOCS modules (Level 2 only).
3. Atom execution layer (`.skillcapsule/atoms/*.json`)
   - Operational implementation: triggers, hooks, runtime commands, and activation behavior.
   - Multiple atoms may satisfy one capability contract.
4. Governance and audit layer (external runtime)
   - Validates approval compliance, evidence, dependency integrity, contract conformance, and execution state.
   - Keeps heavy audit logic outside atom payloads.
5. Temporal intelligence layer (external system)
   - Append-only history and trend analysis live in sibling project `TimeTrace`, not inside atoms.

## LOCS-Capsule Profile v1

Level 1 atoms may include `locs_capsule` with minimal required capability fields:

- `capability_id`
- `capability_name`
- `capability_summary`
- `state_model`
- `side_effects`
- `determinism`
- `risk_level`
- `approval_policy`
- `audit_level`
- `swappable_atom_group`
- `compatibility`
- `success_evidence`

Optional fields:

- `token_efficiency`
- `benchmark_ref`
- `dependency_depth`
- `capability_score`
- `temporal_tracking`
- `temporal_scope`

Explicitly excluded from Level 1 by default:

- Big-O complexity fields (unless algorithmic)
- required TS/public interface sections
- code-module ordering contracts
- heavy implementation metadata

Normalization rules:

- `capability_id` may exist at the atom top level for fast routing, but when `locs_capsule` is present the value must match `locs_capsule.capability_id`.
- `locs_capsule` is the authoritative source for capability contract fields such as `risk_level`, `approval_policy`, `audit_level`, `swappable_atom_group`, `compatibility`, and `success_evidence`.
- atoms without `locs_capsule` remain Level 0 and must not be forced through Level 1 governance requirements.

Schema boundary:

- shape validation is performed before contract validation
- schema failures are hard errors for `skillcap index`
- governance inconsistencies are reported with explicit rule IDs and remediations
- indexing must not emit a success result when contract errors remain

## Progressive reveal routing

Deterministic load order:

1. Load `.skillcapsule/CIF.md`.
2. Load `.skillcapsule/routing.manifest.json`.
3. Resolve `capability_id` and candidate atoms from the generated routing summary.
4. Filter by compatibility constraints.
5. Select atom and run governance checks.
6. Hydrate full atom JSON only for the selected atom set and dependency closure.
7. Load supporting scripts only when the selected atom requires execution.
8. Query temporal history only when risk/evidence gates require historical context.

The runtime must not preload full atom registries, full histories, or unrelated files.

`skillcap index` is responsible for compiling the routing artifact and enforcing the contract boundary:

1. parse atom JSON against the runtime schema
2. normalize contract-derived capability fields
3. validate governance and dependency rules
4. emit generated `.skillcapsule/CIF.md`
5. fail the index run when contract violations remain

## Swappable capability invariants

- `capability_id` is the stable interface contract.
- `swappable_atom_group` is the operational equivalence class.
- atom-level command details are implementation-specific and interchangeable when compatibility is satisfied.
- `success_evidence` defines measurable completion checks independent of command flavor.

## Deterministic governance rules

Validation fails when:

- executable atom has no `approval_policy`
- high-risk atom has no `audit_level`
- swappable atom has no `capability_id`
- declared dependencies are unresolved
- `risk_level` conflicts with `side_effects`

Approval policies supported:

- `auto`
- `auto-if-readonly`
- `approval-required`
- `human-review-required`

## Capability levels

- Level 0: simple atom, no LOCS contract, low-risk/non-executable/local use.
- Level 1: LOCS-Capsule profile, swappable + auditable + governance-aware.
- Level 2: full LOCS module for architecture-heavy reusable code with advanced validation.

Selection rule: always choose the lightest sufficient level.

## Runtime modules impacted

- `src/schemas.ts`: compact runtime schemas for atoms, capsules, hooks, and LOCS-Capsule profile fields.
- `src/validators.ts`: schema parsing, contract normalization, and deterministic governance/dependency validation.
- `src/runtime.ts`: capability routing, compatibility filtering, selection, and policy checks.
- `src/indexer.ts` (or equivalent index path): CIF generation and contract/dependency validation.
- `src/mcp.ts`: expose inspect/select/audit/history/evolve contract-centric operations.
- `bin/skillcap.js`: command entry points for capability-centric CLI.

Generated CIF contract fields:

- `capability_id`
- `risk`
- `swappable_atom_group`
- `mode`
- `compatible_atoms`

These fields are compiled from atom metadata only. CIF must remain generated-only and compact enough for session-start routing.

Generated routing manifest fields:

- atom id, version, file, capability level, capability id
- trigger and activation summaries needed for routing
- dependency/conflict ids for dependency closure without registry preload
- compact capsule membership and default budget data

This manifest is the enforced boundary between cheap routing and full atom hydration.

## External temporal boundary

Temporal fields in atoms are limited to lightweight hooks such as:

- `temporal_tracking`
- `temporal_scope`

Historical state (audit receipts, mutation outcomes, rollback history, governance violations, compatibility drift, token trends, promotion/demotion decisions) is owned by `TimeTrace`.

Integration contract:

- `skillcap history` consumes `tt history --capability-id --format json`
- `skillcap evolve` consumes `tt compare --capability-id --format json`
- opt-in write-back uses `tt record selection` and `tt record audit`
- `skill_capsule` owns recommendation policy and setup diagnostics; `TimeTrace` owns temporal evidence storage and truth-priority ordering
- write-back failures are non-fatal and surface as result warnings so core capability routing does not become unavailable when the temporal sidecar is incomplete
- because `TimeTrace` is still in progress, the runtime resolves the external binary/workspace explicitly and treats missing setup as an operational error, not as “no history”

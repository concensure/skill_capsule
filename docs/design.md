# Skill Capsule Design

## Design intent

Integrate LOCS and Skill Capsule without turning atoms into heavy code-governance documents:

- LOCS carries stable capability contracts.
- Atoms carry executable operational behavior.
- CIF handles low-token routing.
- Audit and temporal intelligence remain external and demand-driven.

## Atom shape preservation

Existing atom JSON shape remains valid. Extension is minimal and additive:

- top-level `capability_id` for invariant contract identity
- optional `locs_capsule` block for Level 1 contract fields
- no mandatory full LOCS module metadata for simple atoms
- Level 0 atoms continue to work unchanged
- when both top-level and nested `capability_id` exist they must match exactly

Example additive pattern:

```json
{
  "id": "code.test.related_tests",
  "capability_id": "regression.integrity",
  "triggers": { "keywords": ["test", "verify", "regression"] },
  "locs_capsule": {
    "capability_name": "Regression Integrity",
    "capability_summary": "Verify repository regression stability",
    "state_model": "external-boundary",
    "side_effects": "explicit",
    "determinism": "deterministic-if-environment-stable",
    "risk_level": "medium",
    "approval_policy": "auto-if-readonly",
    "audit_level": "standard",
    "swappable_atom_group": "regression-test-runner",
    "compatibility": ["vitest", "node>=18"],
    "success_evidence": ["exit_code_zero", "test_report_present"],
    "temporal_tracking": true,
    "temporal_scope": ["audit-results", "selection-history"]
  }
}
```

## CIF routing contract

`skillcap index` generates `.skillcapsule/CIF.md` from atom trigger metadata.

Rules:

- never hand-edit `.skillcapsule/CIF.md`
- route by intent terms to `capability_id`
- include `risk`, `swappable_atom_group`, and effective mode
- keep entries compact for low-token retrieval
- emit only capability-aware rows for atoms with a resolved `capability_id`
- keep non-capability Level 0 atoms out of CIF instead of inventing partial contract rows
- sort output deterministically so repeated index runs are stable

Routing flow:

`CIF.md -> capability_id -> candidate atom group -> compatibility filter -> selected atom -> governance/audit checks`

Implementation detail:

- `capability_id` resolves from top-level `capability_id` first, then `locs_capsule.capability_id`
- `risk` resolves from `locs_capsule.risk_level`, otherwise defaults to `low` for capability rows that intentionally omit richer profile fields
- `compatible_atoms` is derived from the shared `swappable_atom_group`; when no group exists the atom routes to itself
- grouped intent rows must preserve the full candidate atom set behind the capability contract

## Progressive reveal model

1. Load CIF only.
2. Resolve capability contract from generated routing manifest.
3. Load selected atom metadata only for the candidate set being considered.
4. Load scripts/files only when selected atom requires execution.
5. Load temporal/audit history only when risk policy requests historical evidence.

This prevents full-registry and full-history context inflation.

Runtime enforcement:

- `skillcap index` emits `.skillcapsule/routing.manifest.json` as the machine-readable routing summary
- default routing flows (`inspect`, `select`, `match`, `compose`) must use that manifest instead of rescanning `atoms/*.json`
- if the manifest is missing, routing fails fast and instructs the operator to rerun `skillcap index`
- direct atom operations may still hydrate one addressed atom plus dependency closure, because they are no longer routing operations

## Governance model

Governance is deterministic and policy-first:

- required declarations for executable/high-risk/swappable atoms
- explicit approval policy mapped to risk and side effects
- explicit audit expectations and measurable success evidence
- compatibility constraints checked before execution

Validation happens in two stages:

1. Schema validation
   - required atom fields, enum values, render cards, token estimates, and LOCS-Capsule field types
2. Contract validation
   - executable approval policy coverage
   - high-risk audit coverage
   - swappable capability identity
   - dependency resolution
   - risk versus side-effect consistency

Schema errors and contract violations are index-blocking. Warnings may be emitted for inconsistent but non-fatal declarations.

Validation failures include:

- missing `approval_policy` on executable atoms
- missing `audit_level` on high-risk atoms
- missing `capability_id` on swappable atoms
- unresolved dependencies
- inconsistent `risk_level` vs `side_effects`

## Self-auditing runtime split

Atoms declare expectations only:

- `audit_level`
- `success_evidence`
- governance expectations

External audit runtime verifies:

- execution evidence
- dependency integrity
- approval compliance
- capability contract compliance
- unexpected file changes
- exit state
- optional AST validation for code-edit atoms

LLM judgement may assist but cannot be the sole verifier.

## Temporal intelligence split

Temporal history is externalized to sibling project `TimeTrace`.

Inside atoms: only temporal hooks (`temporal_tracking`, `temporal_scope`).

Inside TimeTrace: append-only receipts and evolution intelligence:

- audit receipts and governance violations
- mutation and rollback outcomes
- compatibility and dependency stability history
- token-efficiency trends
- promotion/demotion decisions

Truth ordering for temporal queries:

- verified > unverified
- approved > unapproved
- evidence-backed > inferred
- stable > recent

Recency alone is not truth.

Current integration boundary:

- `skillcap` talks to `TimeTrace` only through the `tt` CLI JSON surface (`history --format json`, `compare --format json`)
- this keeps `TimeTrace` free to evolve internally while `skill_capsule` depends only on a narrow machine-readable contract
- if `tt` or the `.timetrace` workspace is missing, temporal commands fail explicitly with setup guidance rather than silently degrading to empty history
- `--scope` remains advisory until the in-progress TimeTrace project exposes provider-side scope filtering
- write-back remains opt-in: `select` may emit `tt record selection` and `audit` may emit `tt record audit`, but failures are downgraded to returned warnings so routing/audit semantics stay deterministic even while `TimeTrace` is still in progress

## Capability levels

- Level 0: simple atom, no LOCS metadata.
- Level 1: LOCS-Capsule Profile v1, swappable and auditable.
- Level 2: full LOCS module for architecture-heavy reusable code.

Selection policy: use the lightest sufficient level.

## Command surface target

Extend command behavior around capability contracts:

- `skillcap index`: generate CIF and validate schema/contracts/dependencies.
- `skillcap inspect <capability_id>`: list compatible atoms + policy expectations.
- `skillcap select <capability_id>`: choose best atom for current project compatibility.
- `skillcap audit <atom_id>`: validate evidence + governance compliance.
- `skillcap evolve <capability_id>`: compare historical outcomes for level/promotion guidance.
- `skillcap history <capability_id>`: targeted temporal lookup via TimeTrace.

Current implementation priority:

- `T1`: additive schema support for `capability_id` and `locs_capsule`
- `T2`: deterministic contract validation rules with explicit rule IDs
- `T3`: `skillcap index` routed through the shared indexer so CIF generation and validation are not duplicated in the CLI

## Non-goals

- forcing all atoms into full LOCS code-module format
- embedding long-term history inside atom JSON
- loading all atoms/histories during normal routing
- adding metadata not required for operational or governance decisions

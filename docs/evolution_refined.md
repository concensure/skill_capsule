# Skill Capsule - Refined Evolution Design

Aim: retain project shape, avoid token bloat, and maintain reliable governance.

---

## Evaluation of the current proposal

Verdict: the current `docs/evolution.md` is sound in direction, but only partially sound as an approval mechanism.

What is strong:

- Evolution is kept off the hot path.
- Patch files remain the only mutation boundary.
- Existing artifacts and outcomes are reused instead of introducing a new service.
- The Modifier / Evaluator split is the right control shape.

What is weak:

- A single composite governance score is too blunt to authorize changes safely.
- Some proposed metrics are not yet reliably observable, especially retrieval precision and activation accuracy.
- A score delta can hide regressions. One metric can improve while another degrades.
- Sparse history will make early scores noisy, which makes ratcheting unstable.
- Writing approval-critical data only into `INDEX.md` mixes human-facing reporting with machine gating.

Conclusion: keep the architecture shape, but replace score-first approval with invariant-first validation plus per-metric evidence thresholds.

---

## Design principles

1. Evolution stays offline. No scoring or mutation logic enters capsule composition.
2. Patch files remain the only write path into live atoms.
3. Approval is based on explicit invariants first, metrics second.
4. Metrics are stored as structured data, not only as rendered markdown.
5. Auto-approval is allowed only for low-risk patch classes with enough evidence.
6. Missing evidence must degrade to `needs_human_approval`, never to silent pass.

---

## Refined evolution model

### 1. Split metrics from decisions

Do not use one integer as the primary gate. Keep a score if it is useful for ranking or reporting, but approval should read a structured scorecard:

```json
{
  "atom_id": "code.review.diff_risk",
  "evidence_window": {
    "runs": 42,
    "from": "2026-05-01T00:00:00Z",
    "to": "2026-05-12T23:59:59Z"
  },
  "metrics": {
    "token_efficiency": 0.91,
    "hook_pass_rate": 1.0,
    "activation_accept_rate": 0.83,
    "retrieval_precision": null
  },
  "confidence": {
    "token_efficiency": "high",
    "hook_pass_rate": "high",
    "activation_accept_rate": "medium",
    "retrieval_precision": "none"
  }
}
```

`retrieval_precision` is nullable because the current system does not always record ground truth.

### 2. Ratchet by invariant, not only by score

Patch validation should apply three layers:

Layer A - hard invariants:

- no locked field edits
- no hook changes through patch operations
- no activation broadening unless explicitly allowed by patch class
- no token budget violation
- no safety weakening
- no duplicate or conflicting triggers

Layer B - metric guardrails:

- token efficiency must not regress past threshold
- hook pass rate must not regress
- activation accept rate must not regress past threshold
- metrics with no evidence cannot justify auto-approval

Layer C - optional summary score:

- useful for ranking proposals
- never the sole approval criterion

### 3. Patch classes determine approval strictness

Not all patch types should use the same ratchet.

Low-risk, potentially auto-approvable:

- `add_example`
- `deprecate_example`
- `append_evidence`
- `change_status` to a stricter state
- `tighten_activation`
- `remove_trigger_keyword`

Medium-risk, usually human-reviewed unless evidence is strong:

- `replace_render`
- `add_trigger_keyword`

High-risk, never auto-approved:

- any new patch type that broadens capability reach
- any future hook-related or policy-related mutation

### 4. Evidence windows must be explicit

Approval should never compare arbitrary lifetime averages. Use a bounded evidence window:

- minimum run count before auto-approval is even possible
- compare candidate metrics against the same recent window
- mark low-sample proposals as `insufficient_evidence`

This avoids one old burst of good outcomes masking recent regressions.

### 5. Store machine-readable metrics outside `INDEX.md`

`INDEX.md` is useful for operators, but validator logic should not depend on parsing markdown.

Write a structured file during indexing, for example:

`.skillcapsule/metrics/governance.json`

The index command can still render a human summary into `INDEX.md`, but validation should read the JSON artifact.

### 6. Treat retrieval precision as staged capability

The current proposal assumes `matched_atoms` versus `expected_atoms` is readily available. That is not yet guaranteed. Make this staged:

- Stage 1: rely on token efficiency, hook pass rate, and activation acceptance.
- Stage 2: once outcome capture reliably includes expected atom labels, enable retrieval precision in guardrails.
- Stage 3: add replay or benchmark suites only if needed.

### 7. Mutation memory should record decisions, not only outcomes

The optional `mutation_record` field is useful, but it should capture the review decision explicitly:

```json
{
  "mutation_record": {
    "patch_id": "patch-2026-05-13-001",
    "mutation": "add_trigger_keyword:patch->code.review.diff_risk",
    "decision": "accepted",
    "decision_mode": "human",
    "scorecard_before": {
      "token_efficiency": 0.89,
      "hook_pass_rate": 1.0,
      "activation_accept_rate": 0.78
    },
    "scorecard_after": {
      "token_efficiency": 0.90,
      "hook_pass_rate": 1.0,
      "activation_accept_rate": 0.82
    },
    "evidence_run_ids": ["run-abc123", "run-def456"]
  }
}
```

This makes later audits meaningful without introducing a new data store.

---

## Practical approval flow

1. `skillcap index` computes per-atom metrics from compiled artifacts and outcomes.
2. It writes machine-readable metrics to `.skillcapsule/metrics/governance.json`.
3. It renders a human summary into `.skillcapsule/INDEX.md`.
4. Modifier proposes a patch into `.skillcapsule/patches/pending/`.
5. `skillcap patch validate` applies structural checks, invariant checks, and metric guardrails.
6. Validator returns one of:
   - `auto_approvable`
   - `needs_human_approval`
   - `rejected`
7. Accepted patches are applied through the existing patch flow and recorded in outcome history.

---

## Why this better meets the aim

### Retain project shape

No new service, database, or runtime path is introduced. The model remains file-backed, CLI-driven, and patch-based.

### Avoid token bloat

All evolution logic remains outside composed capsules. Only atom content changes can affect prompt size, and those changes remain budget-gated.

### Maintain reliable governance

Reliable governance comes from explicit invariants and conservative evidence handling. A single blended score is not reliable enough on its own.

---

## Recommended implementation order

1. Add structured outcome fields needed for activation acceptance and mutation decisions.
2. Add `skillcap index` metric extraction and write `.skillcapsule/metrics/governance.json`.
3. Render a human summary into `INDEX.md` from that JSON.
4. Extend `patch validate` with invariant and guardrail checks.
5. Add patch risk classes and map each supported operation to a class.
6. Upgrade `meta.propose.composite` to emit evidence-backed patch proposals.
7. Add retrieval precision only after expected-atom capture is trustworthy.

---

## Bottom line

The original proposal has the right boundaries but an approval model that is too optimistic. The refined version keeps the same architecture and makes one key change: evolution is governed by explicit safety and evidence guardrails, with scores used for reporting and ranking rather than as the single source of truth.

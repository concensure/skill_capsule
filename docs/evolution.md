# Skill Capsule — Evolution Proposal

Three goals constrain every choice here: retain project shape, avoid token bloat, maintain reliable governance.

---

## Evaluation of the source lessons

### Lesson 1 — Continuous evolution of the registry

Valid, with one constraint: evolution must happen off the hot path. The LLM never sees evolution metadata. Candidates for continuous improvement:

- atom trigger keywords (retrieval precision)
- CIF routing quality (false positives, missed activations)
- render card token efficiency (actual vs. estimated)
- activation mode assignments (inspect vs. activate mismatches)
- governance score weights (tuned from outcome history)

All of these are already measurable from existing artifacts and outcomes. No new infrastructure is required to start collecting signal.

### Lesson 2 — Ratchet mechanism

The strongest single addition available. The existing patch validator already checks token budget impact and safety weakening. The ratchet extends this to a composite governance score:

> A patch is auto-approvable only if its governance score is at or above the current score. Any regression requires explicit human approval.

This is not a new system. It is one additional check in `patch validate`.

### Lesson 3 — Modifier and Evaluator separation

Already present in embryonic form:

- `meta.propose.composite` atom is the Modifier — it proposes patches from pattern evidence.
- `patch validate` is the Evaluator — it checks structural correctness.

The gap is that the Evaluator does not currently check governance score, token metrics, or retrieval precision. Closing that gap is the most important near-term work.

The separation should be enforced by convention, not by separate processes: Modifier produces a patch file, Evaluator validates it. No shared mutable state between them.

### Lesson 4 — Evidence-based evolution

Adopt the principle selectively. Feasible now:

- token measurement — actual S/O/X cost from composed artifacts vs. `token_estimate`
- retrieval precision — outcome `matched_atoms` vs. `expected_atoms` when recorded
- hook pass rate — `after_action` hook results aggregated from artifact history

Future work (not yet):

- AST validation hooks for atom source files
- type checking on patch proposals
- replay benchmark suites

Do not block evolution capability on the future items.

### Lesson 5 — Evolution memory

The outcome system already exists at `.skillcapsule/outcomes/`. Extend the schema with a `mutation_record` field:

```json
{
  "mutation": "add_trigger_keyword:patch->code.review.diff_risk",
  "score_before": 74,
  "score_after": 81,
  "token_delta": -0.12,
  "accepted": true,
  "evidence_run_ids": ["run-abc123", "run-def456"]
}
```

This is stored in the same file format, same directory, same artifact indexing. No new storage layer.

### Lesson 6 — Capability ecosystem vs. prompt evolution

Accurate framing. This project evolves capability atoms, routing tables, and governance policies — not prompts. The strategic value is in the ratchet: a self-improving system that cannot regress without a human decision.

---

## Proposed evolution architecture

### Governance score

A single integer (0–100) computed per atom and per capsule from available evidence. Components:

| Component | Source | Weight |
|---|---|---|
| Token efficiency | actual cost / estimated cost from artifact history | 30% |
| Retrieval precision | matched atoms / expected atoms from outcomes | 30% |
| Hook pass rate | passing hooks / total hooks from artifact history | 25% |
| Activation accuracy | accepted activations / total activations from outcomes | 15% |

Score computation runs in `skillcap index` and is written to `.skillcapsule/INDEX.md` (already generated). It does not enter the prompt path.

### Ratchet

Extended patch validator behaviour:

```
patch validate <patch-file>

Current checks (existing):
  ✓ base version matches
  ✓ atom exists
  ✓ operation is allowed
  ✓ locked fields not touched
  ✓ token budget not exceeded
  ✓ safety not weakened
  ✓ no duplicate triggers

New checks:
  ✓ governance score after >= governance score before   → auto-approvable
  ✗ governance score after < governance score before    → requires human approval
```

The ratchet output is a field in the existing validation result:

```json
{
  "status": "PASS",
  "violations": [],
  "governance": {
    "score_before": 74,
    "score_after": 81,
    "delta": 7,
    "auto_approvable": true
  }
}
```

### Modifier / Evaluator contract

```
Modifier (meta.propose.composite atom)
  Input:  outcome history, artifact history, CIF.md
  Output: .skillcapsule/patches/pending/<id>.json

Evaluator (skillcap patch validate)
  Input:  patch file
  Output: validation result with governance field
  Rule:   never reads from Modifier state; only reads the patch file + atom registry
```

Neither agent mutates live atom files. The patch file is the only handoff.

### Evolution memory schema (extends existing outcome format)

```json
{
  "id": "outcome-<timestamp>",
  "atom_id": "code.review.diff_risk",
  "task_type": "coding",
  "matched_atoms": ["code.review.diff_risk", "code.edit.safe"],
  "expected_atoms": ["code.review.diff_risk"],
  "hook_results": [...],
  "mutation_record": {
    "mutation": "add_trigger_keyword:patch->code.review.diff_risk",
    "score_before": 74,
    "score_after": 81,
    "token_delta": -0.12,
    "accepted": true,
    "evidence_run_ids": ["run-abc123"]
  }
}
```

The `mutation_record` field is optional. Outcomes without mutations remain unchanged.

### What stays outside scope

The following would violate the three project goals and are explicitly excluded:

- LLM calls in the hot path for scoring
- Separate evolution service or database
- Governance metadata visible in compiled capsule output
- Automatic atom mutation without patch file + validation
- Full benchmark replay suites (future work, listed in design.md already)

---

## Implementation sequence

1. Add governance score computation to `skillcap index` — reads from artifact and outcome history, writes scores into `INDEX.md` alongside existing atom entries. No new files.

2. Extend `patch validate` with ratchet check — reads pre-computed scores, adds `governance` field to output. One new check function in the validator.

3. Extend outcome schema with optional `mutation_record` — no breaking change, existing outcomes remain valid.

4. Add `skillcap score` command — prints per-atom and per-capsule governance scores from the last index run. Thin wrapper over the computed INDEX.md data.

5. Wire `meta.propose.composite` to read outcome history and emit patch proposals with evidence — completes the Modifier side.

Steps 1–3 are self-contained and can ship independently.

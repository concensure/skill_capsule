8. External Temporal Intelligence Layer

Temporal awareness MUST exist outside the LOCS-Capsule system.

Do NOT store:
- mutation history
- evolution history
- benchmark history
- audit history
- regression history

inside capsules or atom JSON files.

Capsules must remain:
- lightweight
- retrieval-efficient
- deterministic
- capability-focused

Capsules may only expose temporal hooks:

{
  "temporal_tracking": true,
  "temporal_scope": [
    "audit-results",
    "selection-history",
    "regression-events"
  ]
}

The actual temporal system MUST be implemented as a separate append-only Temporal Intelligence Layer.

The Temporal Intelligence Layer stores:
- audit receipts
- mutation outcomes
- rollback history
- token efficiency evolution
- governance violations
- dependency instability
- project compatibility history
- promotion/demotion decisions

Temporal retrieval MUST be selective and evidence-gated.

Do NOT automatically inject historical data into context.

Temporal query flow:

CIF.md
→ capability contract
→ candidate atom
→ current project compatibility
→ optional targeted temporal lookup

Truth prioritisation MUST follow:

verified > unverified
approved > unapproved
evidence-backed > inferred
stable > recent

Recency alone MUST NOT determine truth.

Temporal awareness SHOULD primarily apply to:
- refactor safety
- dependency stability
- audit regressions
- token efficiency evolution
- governance drift
- repeated failure patterns

Temporal awareness SHOULD NOT heavily track:
- trivial utility atoms
- low-risk isolated helpers
- static informational skills

The Temporal Intelligence Layer MUST support:
- promotion
- rollback
- mutation comparison
- evidence ranking
- stability scoring

without increasing capsule retrieval cost.
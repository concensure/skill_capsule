# Claude Skill Capsule

Use `.skillcapsule/` for capsule registry and hooks.

## Discovery — two-hop routing

Before any skill operation load `.skillcapsule/CIF.md` (one read, ~200 tokens).
Then load only the single atom or capsule JSON it routes you to.

```
CIF.md  →  matched atom/capsule JSON  →  run
```

Never read the full `atoms/` or `capsules/` directories.

## CIF.md format

```
intent_terms -> id | risk | deps | mode
```

- `deps: capsule` — load the capsule JSON, not an atom JSON
- `deps: none` — standalone atom, no prerequisites
- `mode: activate` — execute immediately
- `mode: inspect` — read-only preflight check or verification
- `mode: approval` — requires explicit user confirmation before proceeding
- `mode: block` — must not activate; guards destructive paths

## Regenerating the index

Run after adding or modifying any atom or capsule:

```
skillcap index
```

This regenerates both `.skillcapsule/CIF.md` and `.skillcapsule/INDEX.md` from source.
Never hand-edit these files — they are generated artefacts.

## Source of truth

```
.skillcapsule/
  atoms/*.json       ← source of truth
  capsules/*.json    ← source of truth
  CIF.md             ← generated (compact routing table)
  INDEX.md           ← generated (human-readable catalogue)
```

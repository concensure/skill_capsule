<!-- generated: true -->
<!-- source: atoms/*.json capsules/*.json -->
<!-- do-not-edit: true -->

intent_terms -> id | risk | deps | mode

 -> code.local.guard | low | capsule | activate
edit|change|modify|update|fix|refactor|restructure|move|rename|clean up|test|verify|check|regression|typescript|rust|go|java|type|compilation|patch|diff|review|risk -> code.safe.edit | high | capsule | inspect
github|push|upload|commit|message|publish -> github.upload.safe | high | capsule | approval
 -> meta.capsule.architect | low | capsule | activate
skill|hook|usage|pattern|evolve|optimize|propose hook|new capsule|composite skill -> meta.evolution | medium | capsule | inspect

edit|fix|update -> code.edit.safe | low | none | activate

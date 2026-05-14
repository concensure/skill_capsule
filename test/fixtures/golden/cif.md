<!-- generated: true -->
<!-- source: atoms/*.json capsules/*.json -->
<!-- do-not-edit: true -->

intent_terms -> capability_id | risk | group | mode | atoms

change|edit|fix|modify|update -> code.edit.scope_guard | risk:medium | group:code-edit-scope-guard | mode:inspect | atoms:code.edit.scope_guard
check|fix|regression|test|verify -> code.verify.related_tests | risk:medium | group:code-verify-related-tests | mode:activate | atoms:code.test.related_tests
commit|github|message|push|upload -> github.commit.message | risk:low | group:github-commit-message | mode:activate | atoms:github.commit.message
compilation|go|java|rust|type|typescript -> code.verify.typecheck | risk:medium | group:code-verify-typecheck | mode:inspect | atoms:code.verify.typecheck
edit|fix|update -> code.edit.safety | risk:medium | group:code-edit-safety | mode:activate | atoms:code.edit.safe
github|push|upload -> github.publish.preflight | risk:medium | group:github-publish-preflight | mode:inspect | atoms:github.upload.safety
publish|push|upload -> github.publish.execution | risk:high | group:github-publish-execution | mode:approval | atoms:github.push.confirmation

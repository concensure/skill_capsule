# Coding Skill

## Safe Edit <!-- @id: code-edit-safe -->
Enforce project boundaries and type safety during edits.

Triggers:
- `edit`
- `fix`
- `update`

Verification:
1.  **Scope Guard:** Check `git diff` against allowed paths.
2.  **Typecheck:** Run `npm run typecheck` or equivalent.
3.  **Related Tests:** Run tests for changed files.

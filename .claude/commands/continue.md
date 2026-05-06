## Task

Continue our work using the branch-scoped progress file as context.

### Steps

1. **Get current branch:** Run `git branch --show-current`.
2. **Resolve progress path:**
   - Slug = part after last `/` in branch (or full branch if no slash).
   - Target: `.claude/progress/{slug}/progress.md`
   - If that folder does not exist, check for any folder under `.claude/progress/` whose name is contained in the branch name; use the longest match.
3. **Read** the resolved `progress.md` (if it exists) to load context: Active Branch, Session Work, Pending/Next Steps.
4. **Continue work** based on that context — prioritize Pending/Next Steps, in-progress items, or the next logical task.

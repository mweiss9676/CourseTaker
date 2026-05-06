## Task

Create a git commit for the current staged and unstaged changes.

### Steps

1. **Assess what's changed:** Run these in parallel:
   - `git status` and `git diff` (staged + unstaged) to understand scope
   - `git log --oneline -10` to match existing commit message style
   - Read the branch-scoped progress file for context on what was done:
     - Get branch: `git branch --show-current`
     - Slug = part after last `/` (or full branch name)
     - Read `.claude/progress/{slug}/progress.md` if it exists
2. **Stage all changes:** Run `git add .` — `.gitignore` handles exclusions.
3. **Draft a commit message:**
   - One short subject line (50–72 chars), imperative mood ("add", "fix", "update" — not "added" or "adds")
   - Use the progress file's completed work as the source of truth for what to summarize
   - No body unless the why is non-obvious
   - End with: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`
4. **Commit** using a HEREDOC to preserve formatting:
   ```bash
   git commit -m "$(cat <<'EOF'
   subject line here

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
   EOF
   )"
   ```
5. **Confirm** by running `git status`, then report to the user:
   - The commit message that was used
   - The list of filenames included in the commit

### Rules

- Never use `--no-verify` or skip hooks — if a hook fails, fix the underlying issue.
- Never amend a previous commit; always create a new one.
- Never force push.
- Do not push to remote unless the user explicitly asks.

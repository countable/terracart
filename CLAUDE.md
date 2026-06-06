# CLAUDE.md

## Parallelism rules

- **Don't use `git stash` or `git worktree`** for parallel work.
- If two pieces of work would touch the same file, **do not parallelize them**.
  Either run them serially in one agent, or split the work along file
  boundaries so each agent owns disjoint files.
- Before spawning multiple agents, list the files each one would write and
  confirm the sets don't overlap. If they overlap, restructure or serialize.

## Subagent rules

- **Subagents must NOT run any `git` commands.** No `git add`, `git commit`,
  `git push`, `git stash`, `git checkout`. The parent agent handles every
  git operation. Give the subagent the commit SHA / branch state it needs
  in its prompt instead of asking it to look git up.
- **Subagents must NOT modify `index.html`.** The script-tag list and
  cache-bust `?v=NN` is the parent's responsibility. The subagent reports
  *what* should be added; the parent edits index.html in one place at the end.
- For multi-file refactors that delete from a shared file (e.g. extracting
  modules from `app.js`), tell each subagent to **CREATE its new module
  only** and **report exact line ranges to delete from the shared file**.
  The parent does the deletions in one coordinated pass after all subagents
  return — this avoids merge-conflict-style line-number drift between
  parallel agents touching `app.js`.

## QC rules

- **Interactables must be clearly in one cell.** Other than houses and fauna,
  every interactable should visually occupy a single tile — its art and
  collision box must align to the same cell. If it appears to straddle a cell
  boundary, or if the sprite and hitbox don't obviously belong to the same
  cell, that is a bug. Fix the offset, anchor, or collision rect before shipping.

## Testing

- The test harness (`test/run_tests.py`) needs a browser, which isn't always
  available in this environment. When you can't run it, just say the tests
  weren't run and rely on a careful code review — **don't editorialize about
  lacking browser access or blocked downloads.** State it plainly and move on.

## Commits

- Commit freely as work completes; no need to ask before committing.
- **Always ask before pushing.** When work is ready to go up, ask whether
  to push rather than pushing automatically.
- **Never rebase, always merge.** If integrating remote changes, use
  `git merge` (or `git pull --no-rebase`). Do not run `git rebase`,
  `git pull --rebase`, or `git pull` when `pull.rebase` is configured.

## Branching

- **Work on the feature branch designated for the session** (the branch
  named in the session/task instructions). Create it locally if it
  doesn't exist yet.
- **Never push to a different branch without explicit permission.** In
  particular, don't merge to or push `main` on your own — ask first.

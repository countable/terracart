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

- **The "one cell" sprite-position rule.** For every world sprite EXCEPT
  buildings (house / tower / shrine / produce stands / pot-of-gold) and moving
  actors (creatures):
    1. The sprite's **visible art** (its opaque, trimmed bounds — NOT the frame
       box, which often has transparent padding) must **never cross the cell's
       bottom edge** (never overlap the cell below).
    2. Art that **fits** in the cell (height ≤ one cell) is **centred** vertically.
    3. Art that **doesn't fit** is seated with its **bottom 1px above** the edge.
    4. Art is **always centred horizontally** on the cell.
  This is enforced in code by the seat pass in `src/render.js` + the single
  source of truth in **`src/sprite_layout.js`** (`seatInCell` + the `ART_BOUNDS`
  trimmed-bounds table). To make a sprite obey it, give its `RENDER_SPEC` entry
  `seat: true` (the renderer computes `dxPx`/`dyPx` from the rule; `origin` is
  then just the no-SpriteLayout fallback anchor). For animated sheets, set
  `seatFrame` to a stable frame so the art doesn't bob.
  **Audit it:** `node tools/sprite_audit.js` (also run as part of
  `node test/node/run.js`). It decodes the real PNGs, checks `ART_BOUNDS` hasn't
  drifted, and verifies every seated sprite obeys the rule. When art changes,
  regenerate the table with `node tools/sprite_audit.js --emit-bounds` and paste
  it into `src/sprite_layout.js`.

- **The creature "crown" rule (work wheel).** Creatures are exempt from the
  one-cell rule above (they're feet-anchored moving actors), but the
  work-progress wheel drawn over one is not free-floating: it **rests on** that
  kind's **crown** — the ring's TOP EDGE sits on the top row of its visible art
  at rest — so the whole wheel reads as sitting on the animal, at any size.
  An animal shorter than the wheel's diameter can't give up a full radius
  without the ring sliding off its feet, so the drop is capped at half the art's
  height and the wheel centres on its midline instead.
  It's derived, not tuned: the per-kind draw geometry (frame, scale, foot
  origin, constant float, trimmed art rows) lives in
  **`src/sprite_layout.js`** › `CREATURE_ART`, which `render.js` draws from and
  `app.js` places the wheel from via `creatureWheelDy(kind)`; the ring radius
  lives there too (`CREATURE_WHEEL_R`) so the number that draws the wheel and
  the number that seats it can't drift apart. Never re-tune the wheel with a
  flat px offset — one number can't fit a chicken and a cow, which is how it
  ended up 4px above the chicken and down at a perched crow's feet.
  **The wheel CENTRED on the crown until Aug 2026**, which left a full radius
  (10px) of ring in the empty sky above every animal — a constant overshoot, so
  it read as too high on all of them and worst as a fraction of the small ones.
  If you are tempted to centre it on the crown again, that is the bug.
  **Audit it:** `node tools/sprite_audit.js` (also in `node test/node/run.js`)
  re-decodes the creature PNGs and fails if `CREATURE_ART` has drifted from the
  art, if a wheel has left its seating, or if any ring floats above a crown it
  is tall enough to sit on.

## Testing

- The test harness (`test/run_tests.py`) needs a browser, which isn't always
  available in this environment. When you can't run it, just say the tests
  weren't run and rely on a careful code review — **don't editorialize about
  lacking browser access or blocked downloads.** State it plainly and move on.

## Commits

- Commit freely as work completes; no need to ask before committing.
- **When all pending work is done, merge to `main` and push `main` — no
  need to ask.** Don't push the session/feature branch; the feature branch
  is the workspace, `main` is what goes up. "Done" means everything the
  user asked for is finished and the tests you can run are green — a
  half-finished change stays on the branch until it isn't.
- **Never rebase, always merge.** If integrating remote changes, use
  `git merge` (or `git pull --no-rebase`). Do not run `git rebase`,
  `git pull --rebase`, or `git pull` when `pull.rebase` is configured.

## Branching

- **Work on the feature branch designated for the session** (the branch
  named in the session/task instructions). Create it locally if it
  doesn't exist yet.
- **Minor changes can go straight to `main`** — a one-line constant, a
  colour or copy fix, a small self-contained tweak to one file. Commit on
  `main` and push; no branch, no merge commit. Anything bigger — work
  spanning several files, a new module, a behaviour change worth reading
  as one unit — belongs on the session branch.
- **When work is ready, merge to `main` and push `main`** (via `git merge`,
  never rebase) rather than pushing the feature branch. Go ahead and do it
  — no approval needed.

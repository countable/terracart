# Gameplay QA agent

Run the real game through a text interface with screenshots and an accelerated,
paused-between-actions simulation. Nothing here is loaded by the shipped page.
The measured run never enables TEST_MODE or grants resources.

## Start and play

```sh
node tools/qa/run.js ~/.artifacts/gameplay-qa/my-run
node tools/qa/client.js '{"action":"observe"}'
QA_STATE=/tmp/my-run-player.json node tools/qa/play.js
```

Requires `playwright-core`, Chromium (`PW_CHROMIUM` overrides `/usr/bin/chromium`),
and the nine checked-in `test/fixtures` tiles. The runner starts its own localhost
HTTP server and a timestamped directory under `~/.artifacts/gameplay-qa` when no
output path is supplied. It defaults to port 7732 (`QA_PORT` overrides it), and uses a fresh
browser context. Keep the process alive while issuing commands. `play.js` is a
conservative policy that stops for an agent when it encounters an unfamiliar
choice. `QA_STEPS` limits each policy invocation. Use a new `QA_STATE` for each run.
The supervising agent is the agent running these commands; no separate model
API key is required.

Commands are JSON POSTs to `/command`; `client.js` prints compact responses.
Use `--full` for the complete JSON, including all visible terrain cells.

| Action | Arguments | Meaning |
|---|---|---|
| observe | | Visible map, objects, HUD, inventory, menus and controls |
| start | | Freeze the clock after fresh-game onboarding; starts the 120-minute budget |
| move | direction: north/east/south/west | Hold the normal stick until one adjacent cell is entered |
| interact | target: observed ID | Tap an observed object or terrain cell normally |
| activate | control: observed ID | Activate a currently available UI control |
| scroll | deltaY: pixels, default 400 | Scroll the visible menu through normal mouse-wheel input |
| wait | seconds: up to 300 | Advance bounded simulation steps; interrupt on a new dialog, completed work or substantial energy loss |
| capture | reason | Screenshot and matching observation |
| checkpoint | | Save reviewer-only state; not player knowledge |

Add `reason` to an interaction for before/after screenshots. Menu changes and
periodic checkpoints also cause automatic screenshots. IDs are observations,
not an API for guessing unseen objects. An accepted tap may still be refused by
the game; inspect feedback and state changes. The normal stick can drift back
toward GPS after inactivity. Movement means entering the adjacent cell, not
snapping to its center. No direct coordinate writes occur.

## Instructions for the supervising QA agent

1. Follow the opening story, choose Easy, then start the clock. Use only the
   player observation for decisions. Keep the story bible and hidden save
   checkpoint in the reviewer role.
2. Follow the displayed tutorial, explore visible leads, read conversations,
   try combat and trade when affordable. Do not optimize using source-code
   knowledge, teleport, grant items, force growth, or unlock progress.
3. Account for reading/decision time explicitly with wait commands. Preserve
   timer delays instead of repeatedly tapping a card before its controls appear.
4. Screenshot first encounters, dialogue, milestones, surprising feedback and
   before/after states for suspected bugs. Avoid repeated captures of unchanged
   cards. Check screenshots against text periodically to catch bridge omissions.
5. On a stall, try a small number of reasonable alternatives. Record the blocker,
   then explore another visible lead. Do not rescue the save invisibly. Stop on
   persistent harness errors, missing fixture coverage, or a broken simulation.
6. Aim for 7,200,000 simulated milliseconds, but report actual time and coverage.
   Do not fill the budget with unexplained idling. Long waits should serve a
   stated player goal such as crop growth or recovery.
7. Review encountered story against docs/design/story.txt and balance as a
   hypothesis from one location/policy. Reproduce suspicious accelerated results
   at ordinary speed before calling them game defects.

## Timing and verification

`clock.js` is injected before boot, intercepts timers/RAF, then freezes Date and
performance clocks together. It uses Phaser's normal headless update path in
steps no larger than 50ms and renders after each command. Async loading can
finish while simulation is paused. Browser CSS animations are not simulated
physics and may settle on wall time. This harness is not a performance test.

```sh
npm run test:qa
node tools/qa/verify-clock.js
node tools/qa/report.js ~/.artifacts/gameplay-qa/my-run
```

The clock verification uses isolated fixtures to compare normal and accelerated
behavior; those mutations never enter the measured playthrough. The report
reads `run.json`, `actions.jsonl`, and optional `findings.json` (an array with
`title`, `severity`, `description`, `evidence`, `reproduction`, `confidence`, and
relative `screenshot`). Optional `coverage.json` is an array of reviewed coverage
paragraphs. It emits `index.html` and `summary.json` beside evidence.
Serve it through the shared artifact server at
`http://localhost:8765/gameplay-qa/my-run/index.html`.

Recorded fixtures, random seed, source hashes, actions, and reviewer checkpoints
support reproduction. Asynchronous ordering can vary, so replay must compare
observations and stop at a mismatch rather than blindly clicking stale IDs.
Live map availability, device GPS, service-worker caching, multiplayer, other
starting locations, and story branches never encountered are outside this run.

For cautious transcript replay, start a second fresh runner on another `QA_PORT`
and run `node tools/qa/replay.js /path/to/actions.jsonl`. It remaps observed
control labels/DOM IDs and stops on visible state divergence. Replay is a
reproduction aid, not proof of determinism or a substitute for normal-speed
confirmation of a suspected clock-sensitive issue.

For bridge development during a paused run, `POST /maintenance` with
`{"action":"reload-bridge","reason":"describe the repair"}` reloads only the
observation/action bridge. It requires a started, stationary session, verifies
that save/time are unchanged, and records source revisions in the evidence.
It is a harness maintenance operation, not a player action.

To verify first-sale story sequencing at normal speed, run `node tools/qa/reproduce-first-sale.js /path/to/reproduction-output`.
This uses an explicitly seeded disposable inventory, performs one normal Sell
clicks, and checks that the story stays queued across repeated sales and opens
only after Leave closes the shop. It does not touch a measured run.

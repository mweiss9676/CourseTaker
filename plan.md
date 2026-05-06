# CourseTaker — Plan

A small Node.js tool that drives a real Chrome window via Puppeteer to click through an online course on the user's behalf. Auth is done **manually by the user** in the visible browser; automation only takes over the "next / continue / submit" loop.

## Goals

- Boot a real Chrome window, let the user sign in by hand, then start clicking.
- Survive the common course-platform "dark patterns": disabled timer-gated buttons, moving/renamed buttons, modal popups, idle-detection prompts, and simple quiz interstitials.
- Be easy to abort / take over manually at any time.
- Stay tiny — single repo, single config file, no DB, no UI beyond the Chrome window itself.

## Non-goals (for v1)

- Bypassing real authentication (CAPTCHAs, MFA, SSO redirects) — we just wait for the user.
- Answering complex free-response questions or anything requiring real comprehension.
- Running headless or in CI. We *want* a visible window so the user can intervene.
- Multi-course orchestration. One course at a time.

## Tech stack

- **Runtime:** Node.js 20+
- **Automation:** [`puppeteer`](https://pptr.dev/) (Playwright is a fine alternative; Puppeteer is fine for one site and the user already mentioned it).
- **Language:** TypeScript (strict). Keeps the selector/handler code readable.
- **Config:** A single `config.json` (gitignored) plus a `config.example.json` checked in.
- **Persistence:** Chrome `userDataDir` so the user only has to log in once.
- **Logging:** `pino` or just `console` with timestamps. Append to `runs/<timestamp>.log`.

## Architecture (one process, three loops)

```
launch Chrome ──► wait for user "ready" signal ──► main click loop
                                                      │
                                                      ├── detector loop  (find "next-like" element)
                                                      ├── handler loop   (deal with popups / quizzes / timers)
                                                      └── watchdog       (no-progress timeout, screenshot on failure)
```

### 1. Launcher (`src/launch.ts`)
- `puppeteer.launch({ headless: false, userDataDir: './.chrome-profile', defaultViewport: null, args: ['--start-maximized'] })`.
- Open the course URL from config.
- Print clear instructions in the terminal: *"Log in, navigate to the lesson you want, then press ENTER here."*
- Wait on `process.stdin` for the user to confirm before any automation starts.

### 2. Detector (`src/detect.ts`)
Goal: given the current page, find the element that advances the course. Strategy is a prioritized list — first hit wins:

1. **Config-provided selectors** for this course (CSS or XPath).
2. **Text match** on visible buttons / links matching a configurable regex (default: `/^(next|continue|proceed|submit|finish|got it|i agree|acknowledge|begin)$/i`).
3. **Aria** — `role=button` with matching accessible name.
4. **Fallback:** the lowest-on-page enabled button inside the main content frame.

Important details:
- Walk **all frames** (`page.frames()`), not just the top frame — courses love iframes.
- Skip elements with `disabled`, `aria-disabled="true"`, `pointer-events: none`, or zero size.
- Prefer elements that are visible in the viewport; scroll into view before clicking.

### 3. Handlers (`src/handlers/*.ts`)
Small, composable checks that run **before** each detector pass. Each returns `true` if it handled something (and the main loop restarts).

- `dismissModals` — close cookie banners, "are you still there?" idle prompts, generic dialogs (configurable selectors + a text-based fallback).
- `waitForTimer` — if the next button is disabled and a countdown / progress bar is visible, just wait and re-poll instead of clicking.
- `playMedia` — if a `<video>` or `<audio>` is on the page, call `.play()` and (optionally) set `playbackRate` to a configured value (default 1.0 to be safe; 2.0 is the obvious knob).
- `answerQuiz` — v1: only auto-handle the trivial cases:
  - Single radio/checkbox with a single option → select it.
  - "Acknowledge / I understand" style → just submit.
  - Anything else → log + screenshot + **pause and beep**, let the user answer manually, then resume on ENTER.

### 4. Main loop (`src/run.ts`)
```
loop:
  for handler in handlers:
    if handler.run(page): continue loop
  el = detect(page)
  if !el:
    if no progress for N seconds → screenshot + pause for user
    else → wait briefly and retry
  else:
    record current URL + section title
    click(el) with a small humanized delay
    wait for either: navigation, DOM mutation that changes section title, or timeout
  if reached configured stop condition → exit
```

### 5. Watchdog
- Track "last progress timestamp" (URL change, section heading change, or successful click).
- If > `stallTimeoutSec` (default 90s) with no progress: take a screenshot to `runs/<ts>/stall-<n>.png`, ring the terminal bell, pause for ENTER.
- Hard cap: max clicks per run (default 500) to avoid runaway loops.

## Config shape (`config.example.json`)

```json
{
  "courseUrl": "https://example.com/course/123",
  "userDataDir": "./.chrome-profile",
  "nextButtonText": "^(next|continue|proceed|submit|finish|got it|begin)$",
  "selectors": {
    "next": [],
    "dismiss": [],
    "quizSubmit": []
  },
  "video": { "autoplay": true, "playbackRate": 1.0, "muted": true },
  "limits": { "stallTimeoutSec": 90, "maxClicks": 500, "minClickDelayMs": 400, "maxClickDelayMs": 1200 },
  "stopWhen": { "urlContains": "/complete", "textContains": "Course complete" }
}
```

## Project layout

```
CourseTaker/
  package.json
  tsconfig.json
  config.example.json
  config.json              # gitignored
  .chrome-profile/         # gitignored, created on first run
  runs/                    # gitignored, screenshots + logs per run
  src/
    index.ts               # CLI entry
    launch.ts
    run.ts
    detect.ts
    handlers/
      dismissModals.ts
      waitForTimer.ts
      playMedia.ts
      answerQuiz.ts
    util/
      log.ts
      sleep.ts
      humanize.ts          # randomized delays / mouse moves
  plan.md
  README.md
```

## Anti-detection / "dark pattern" notes

- **Disabled-until-timer buttons:** never force-click a disabled button — wait. Forcing it via JS often flags accounts.
- **Moving buttons / re-renders:** always re-query right before clicking, never cache element handles across awaits.
- **Idle / "are you still there?" prompts:** treated as just another modal to dismiss.
- **Right-click / dev-tools blockers:** irrelevant — we drive via CDP, not the page's event handlers.
- **Focus/visibility tracking** (some platforms pause when the tab isn't focused): launch with `--disable-backgrounding-occluded-windows --disable-renderer-backgrounding` and keep the window visible. Don't minimize.
- **Humanized delays:** randomize click delay between `minClickDelayMs` and `maxClickDelayMs`. Optional small `mouse.move` before click.
- **Speeding up video** is the most likely thing to trip detection — keep `playbackRate: 1.0` as the default.

## Manual override

- Pressing ENTER in the terminal at any time pauses the automation; pressing ENTER again resumes.
- `Ctrl+C` cleanly closes the browser and writes a final screenshot.
- The user can also just click in the page — the automation treats clicking the same element again as a no-op as long as progress is detected.

## Milestones

1. **M1 — Skeleton (≈30 min):** `npm init`, TS config, launcher, manual-confirm gate, opens config URL.
2. **M2 — Click loop (≈1h):** detector + main loop + click + progress detection on a single test page.
3. **M3 — Handlers (≈1–2h):** modal dismiss, timer wait, video autoplay.
4. **M4 — Quiz fallback + watchdog (≈1h):** trivial-quiz handler, stall detection, screenshots, pause/resume.
5. **M5 — Polish:** README, example config, run logs, stop conditions.

## Open questions for the user

1. Which course/platform is this targeting? Even one example URL lets us pre-fill `selectors.next` and `selectors.dismiss` so v1 works on the first run.
2. Are there quizzes? If yes, do you want auto-answers from a config file (`{ "question regex": "answer" }`), or always pause for you?
3. Is video speed-up acceptable, or strict 1x?
4. Any per-section minimum dwell time you want enforced (some platforms server-side validate elapsed time)?

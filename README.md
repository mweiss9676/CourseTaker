# CourseTaker

A small Node.js + Puppeteer tool that opens a real Chrome window, lets **you** sign in by hand, and then clicks through an online course on your behalf.

It's intentionally not headless and not stealthy — the goal is for you to be able to watch it work and take over instantly when something gets weird.

## What it does

- Launches a visible, persistent Chrome profile (you only log in once).
- Waits for you to press ENTER in the terminal once you're on the right page.
- Loops:
  1. Dismiss obvious modals / "are you still here?" prompts / cookie banners.
  2. Auto-play any `<video>` / `<audio>` (with configurable rate/mute).
  3. If a "Next" button is disabled and a countdown/progress bar is showing, just wait.
  4. Auto-answer trivial quizzes (single-option radio, single "I have read and understand" checkbox).
  5. Find the most "next-like" button anywhere in the page (across iframes) and click it.
- Watches for progress (URL or page heading change). If nothing has progressed for `stallTimeoutSec`, takes a full-page screenshot, rings the terminal bell, and pauses for you.

## What it deliberately does **not** do

- It will not bypass real auth (CAPTCHA, MFA, SSO). You sign in.
- It will not answer non-trivial quiz questions. It pauses and waits for you.
- It does not run headless. Keep the browser visible.
- It does not speed video up by default — set `video.playbackRate` if you want.

## Setup

```bash
npm install
cp config.example.json config.json
# edit config.json — at minimum set "courseUrl"
```

Requires Node 20+. Puppeteer downloads its own bundled Chrome on install.

## Run

```bash
npm start
```

A Chrome window will open at `courseUrl`. In the **terminal**:

1. Sign in to the platform in the open browser.
2. Click into the lesson you want auto-completed.
3. Press **ENTER** in the terminal to start automation.
4. Press **ENTER** again at any time to pause; ENTER once more to resume.
5. **Ctrl+C** to quit.

Run artifacts (stall screenshots) land in `runs/<timestamp>/`.

## Configuration

`config.json` keys:

| key | meaning |
| --- | --- |
| `courseUrl` | URL the browser opens at startup. |
| `userDataDir` | Chrome profile directory. Defaults to `./.chrome-profile`. Persisted between runs so logins stick. |
| `nextButtonText` | Regex (string, case-insensitive) matched against button accessible names. |
| `selectors.next` | Optional CSS selectors checked **before** the text regex. First visible+enabled match wins. |
| `selectors.dismiss` | Extra CSS selectors to try when dismissing modals. |
| `selectors.quizSubmit` | Reserved for future use. |
| `video.autoplay` | Whether to call `.play()` on visible media. |
| `video.playbackRate` | `1.0` is the safe default. |
| `video.muted` | Mute media so autoplay doesn't get blocked. |
| `limits.stallTimeoutSec` | Seconds with no progress before we screenshot + pause. |
| `limits.maxClicks` | Hard cap. |
| `limits.minClickDelayMs` / `limits.maxClickDelayMs` | Randomized delay before each click. |
| `limits.postClickWaitMs` | How long to wait after each click before checking for progress. |
| `stopWhen.urlContains` | If the URL ever contains this substring, the run exits cleanly. |
| `stopWhen.textContains` | Same, but matched against page body text. |

### Tips

- Run once with the heuristics, then check the logs for what got clicked. If anything was wrong, copy a stable CSS selector for the real "Next" button into `selectors.next`. That makes subsequent runs deterministic.
- For courses that gate the next button on elapsed time, leave the timer-handler on (it does nothing if there's no countdown visible).
- If the platform "pauses" video when the tab isn't focused: don't minimize. Move the window to a second monitor instead.

## Project layout

```
src/
  index.ts               # CLI entry
  launch.ts              # Puppeteer setup + manual-confirm gate
  run.ts                 # main click loop + watchdog + pause/resume
  detect.ts              # cross-frame "next button" detector
  config.ts              # config loading + defaults
  handlers/
    dismissModals.ts
    waitForTimer.ts
    playMedia.ts
    answerQuiz.ts
  util/
    log.ts
    sleep.ts
    keys.ts              # stdin ENTER -> pause/resume
plan.md
config.example.json
```

## Troubleshooting

- **It clicks the wrong button.** Add a CSS selector for the real "Next" button to `selectors.next`. Config selectors are tried first.
- **It can't find any button.** It will pause after `stallTimeoutSec` and drop a screenshot in `runs/`. Inspect the screenshot, find a stable selector, add it to `selectors.next`.
- **Modal keeps reopening.** Add its close-button selector to `selectors.dismiss`.
- **Account got flagged.** Slow the click delays down, set `playbackRate` back to `1.0`, and add a higher `postClickWaitMs`.

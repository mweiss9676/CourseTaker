# CourseTaker — How to use this thing

You're driving a real Chrome window with Puppeteer attached over the remote-debugging port. You sign in by hand, the script clicks through the lesson. Visible browser, manual auth, clean exit. No magic.

## One-time setup

```powershell
# from the repo root
npm install
Copy-Item config.example.json config.json
```

Then edit `config.json`:

- `courseUrl` — the lesson URL the script will use to identify the right tab. Doesn't have to be the URL you actually open; it just has to share a host with it.
- `browser.mode` — leave on `"connect"`. (See "Why connect?" below if you care.)
- Everything else: defaults are fine for a first run.

You don't need a clean Chrome profile yet — the helper script makes its own at `C:\chrome-coursetaker`.

## Daily flow

Two terminals.

### Terminal 1 — start the course Chrome

```powershell
powershell -ExecutionPolicy Bypass -File .\start-chrome.ps1
```

Chrome opens with `--remote-debugging-port=9222` and a separate user-data-dir so it doesn't fight with your everyday Chrome. **Leave this terminal alone** — closing it kills the browser.

In that Chrome window:

1. Sign in to the course platform like a human (the LMS's CAPTCHA is much happier with this than with `page.goto`).
2. Click into the lesson you want auto-completed.
3. Get to the point where you'd start clicking yourself.

Cookies persist in `C:\chrome-coursetaker`, so on subsequent days you skip step 1.

### Terminal 2 — start the automation

```powershell
npm start
```

The script:

1. Connects to the existing Chrome over CDP.
2. Picks the tab whose URL host matches your `courseUrl`.
3. Injects esbuild-helper shims, focus/visibility overrides, and `webdriver=undefined` into every frame.
4. Lists every reachable frame with `[ok]` / `[fail]`.
5. Waits on `ENTER`.

Press **ENTER** to start clicking. **ENTER again** pauses; ENTER once more resumes. **Ctrl+C** quits cleanly (it disconnects, doesn't close your browser).

## What happens during a run

Each loop iteration does this in order:

1. Dismiss obvious modals (cookie banners, "are you still here?" prompts, generic dialogs).
2. Restart any paused `<video>`/`<audio>` (silent at INFO; set `DEBUG=1` to see).
3. If a "Next" button is disabled and there's a visible countdown / progress bar, just wait.
4. **Trivial quiz handler** — single-option radio, single "I have read and understand" checkbox.
5. **Real quiz handler** — finds a multi-option radio group, picks the next untried option, clicks any nearby Submit. Tracks tried options per question by fingerprint, retries on wrong answer.
6. **Next-button detector** — searches every frame for a button whose accessible name matches the regex (`next|continue|submit|finish|...`), or one of your `selectors.next` CSS selectors. First hit wins, clicks it.
7. **Explorer** (only if no Next button found for 5+ seconds) — clicks one "lesson interactive" per loop. Conservative pass first (numbered hotspots, icon-only buttons, classes containing `pressable`/`hotspot`/`interactive`/etc., `role=tab`/`menuitem`, plus any `cursor: pointer` element with a digit text). If conservative is exhausted, escalates to aggressive (any short-named visible interactive that isn't on the deny list).
8. After 12s with nothing to click: warns you in the terminal.
9. After 30s: screenshots + dumps every frame's `<body>` HTML to `runs/<ts>/frame-stallN-*.html` and pauses.

Logs you'll see during normal operation:

```
Click #N -> "Continue" (text-regex)
Explore [conservative]: clicked "1" (hotspot/...pressable)
Quiz: tried "Yes" for "Was this behavior harassment?" (attempt 1/4)
```

## Tuning when it goes wrong

Three knobs in `config.json`, in order of usefulness.

### 1. It's clicking things it shouldn't (dashboards, "rate this", report buttons)

Add CSS selectors to `selectors.deny`. Anything inside any of those selectors is invisible to the explorer:

```json
"selectors": {
  "deny": ["[data-tid*='reportIssue']", ".my-feedback-widget"]
}
```

Also: `[data-testid="top-bar"]`, `[data-testid="bottom-drawer"]`, `header`, `nav`, `aside`, and a few common chrome containers are denied by default — you don't need to add those.

### 2. It can't find the Next button

Find a stable CSS selector for the real button (right-click → Inspect → Copy → Copy selector) and add it:

```json
"selectors": {
  "next": [".lesson-next-button", "[data-tid='next']"]
}
```

Selectors are tried *before* the text regex, so this is also how you fix "it keeps clicking the wrong thing first".

### 3. It clicks too fast / triggers rate-limiting

Slow it down:

```json
"limits": {
  "minClickDelayMs": 800,
  "maxClickDelayMs": 2200,
  "postClickWaitMs": 3000
}
```

### Stop conditions

If you know what the "course done" screen looks like, set:

```json
"stopWhen": {
  "urlContains": "/complete",
  "textContains": "Course complete"
}
```

The script will exit cleanly when either matches. Otherwise it just runs until `maxClicks` (default 500) or you Ctrl+C.

## Debugging

- `DEBUG=1 npm start` shows debug-level logs (media start counts, frame eval failures, etc.).
- When stalled, the script auto-dumps each frame's HTML and a candidate-summary to `runs/<ts>/`. The `*.summary.txt` files tell you, per frame, how many "explicit" interactives (button/role/tabindex/onclick) and how many `cursor: pointer` elements were visible. If both are zero, the lesson is using something exotic (canvas, shadow DOM, etc.) and we'll need a custom handler.
- If you see `frame eval failed: ...`, that's a real error from the page. Send the message — silent failures used to be the #1 source of "why isn't this working".

## Why connect mode (and not launch mode)?

You can switch `browser.mode` to `"launch"` and the script will start its own Chrome from scratch. That works fine for most platforms but bot-detection-heavy ones (Rippling-style SSO, anything fronted by hCaptcha or PerimeterX) will flag the puppeteer-launched Chrome on the *login* page, before automation has even started. With connect mode, Chrome is launched by you with no Puppeteer involved — login looks 100% human. We attach after login.

If you don't have a CAPTCHA-heavy auth flow in front of the course, launch mode is simpler (one terminal). But there's no real downside to connect mode either, so the default is connect.

## Files you should know about

- `config.json` — the only thing you should edit normally. Gitignored.
- `start-chrome.ps1` — Chrome launcher for connect mode. Edit if your Chrome lives somewhere weird.
- `runs/<timestamp>/` — screenshots + frame dumps when the script gets stuck. Safe to delete.
- `C:\chrome-coursetaker` — the dedicated Chrome profile. Delete it if your sessions get into a weird state and you want to start fresh.

## Files you should not touch

- `src/` — the actual code. If something doesn't work, send a log instead of guessing.
- `.chrome-profile/` — only used by launch mode. Ignore.

# CourseTaker — Progress

## Active Branch

`master` (no parent)

## Session Work

Built a TypeScript + Puppeteer app that auto-clicks through online courses (target platform: Rippling → Go1 → EasyLlama SCORM iframe). Authentication is manual; the script attaches to a user-launched Chrome via `--remote-debugging-port=9222` ("connect" mode) so login isn't bot-detected.

### Architecture

- `src/index.ts` — CLI entry, manual-confirm gate, SIGINT cleanup.
- `src/launch.ts` — `puppeteer-extra` + Stealth, `connectBrowser` filters out internal Chrome tabs and prefers a tab matching `courseUrl` host. Injects `injectShims` (esbuild `__name`/`__publicField` no-ops so `frame.evaluate` doesn't fail in cross-origin SCORM iframes) and `applyKeepActive` (Page Visibility API + `hasFocus` spoof).
- `src/run.ts` — main loop: dismissModals → playMedia → waitForTimer → answerQuiz → quizSolver → findNextCandidate → Explorer (after 5 s no Next) → media-aware stall watchdog (12 s warn, 30 s pause, screenshot + frame dump).
- `src/detect.ts` — tags a Next-button candidate via `data-coursetaker-target`, returned as a real `ElementHandle` so `handle.click()` is a CDP user gesture.
- `src/handlers/exploreInteractives.ts` — Explorer for "click each hotspot" gates. Conservative mode = only obvious hotspots (numbered text, `pressable`/`hotspot`/`tab`/`card` classes, role=tab/menuitem). Aggressive mode = anything with a short label not on the deny list. Heavy filtering: `DEFAULT_CONTENT_DENY_ANCESTORS` (top-bar, bottom-drawer, etc.), `NAME_DENY_PATTERN` (anchored chrome names), `NAME_DENY_SUBSTRING_PATTERN` for media controls (rewind, pause the, skip, volume, transcript, audio progress, …) checked against the element AND 6 ancestors' aria-label/title.
- `src/handlers/quizSolver.ts` — multi-choice solver: tries untried options per fingerprinted question.
- `src/handlers/{dismissModals,waitForTimer,playMedia,answerQuiz}.ts` — supporting handlers.
- `src/util/{log,sleep,keys,dumpFrames,injectShims,mediaState}.ts` — utilities.

### Major bugs fixed during session

- Rippling CAPTCHA / bot detection → moved to "connect" mode, manual login.
- Attaching to wrong tab (`chrome://omnibox-popup`) → tab filter by URL host.
- Silent `__name is not defined` on every `frame.evaluate` → `injectShims`.
- Watchdog firing during narration → `mediaState.anyMediaPlaying()` resets stall timer when audio/video is active.
- Explorer clicking unintended chrome (Rate this, Overview, Help SVG, "10" inside Rewind 10) → expanded deny ancestors, anchored name regex, substring regex with ancestor walk, SVG `<title>` reading in `accessibleName`.
- Explorer marking itself "exhausted" forever → removed `exhausted` flag; mode resets only on `pageSignature` change.
- **Hotspot `+` audio buttons not actually playing audio.** Root cause: `(el).click()` from inside `frame.evaluate()` is not a user gesture, so Chrome's autoplay policy blocked `audio.play()`. Fix: explorer now tags candidate with `data-coursetaker-explore-target`, gets a real `ElementHandle` via `frame.$()`, and clicks via `handle.click({ delay: 30 })` (CDP `Input.dispatchMouseEvent` = real gesture). Same pattern as `detect.ts`.
- **Multiple `+` hotspots needed but only one being pressed per loop tick.** Fix: added burst mode in conservative-only Explorer — first click + up to 30 follow-up clicks at 250 ms each, until `passOnce` returns null.

### Files changed this session (latest)

- `src/handlers/exploreInteractives.ts` — added `EXPLORE_TARGET_ATTR`; refactored `passOnce` to tag-then-native-click; added burst loop in `tryClickOne`.

## Pending / Next Steps

- **Verify on user's machine:** user reported `+` buttons (`<button aria-label="Play the audio" class="... pressable">`) still not being pressed after burst-mode change. Most likely cause: script wasn't restarted (`tsx` is not hot-reload). Need user to Ctrl+C `npm start` and re-run.
- If it still doesn't fire after restart, ask user for the parent chain (5–6 levels up) of one `+` button to confirm no deny ancestor is matching, and a chunk of run logs to confirm the explorer is reaching `tryClickOne`.
- Possible follow-up if needed: temporary `DEBUG=1` instrumentation in `passOnce` to log every candidate it considered + reject reason.
- Not yet started: `dismissModals` is currently fine per user feedback — they'll close hotspot popups manually if needed; no extra work required there.
- No PR / no commits this session; work is on `master` only.

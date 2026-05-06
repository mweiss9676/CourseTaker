import type { Frame, Page } from "puppeteer";
import { log } from "./util/log.js";

/**
 * Equivalent of the "Always Active Window" Chrome extension.
 *
 * Runs in-page to spoof the Page Visibility API, focus state, and to
 * suppress visibilitychange / blur listeners. This stops courses from
 * pausing video / freezing timers when the tab isn't focused.
 *
 * Notes / caveats:
 *  - Script registered via evaluateOnNewDocument runs BEFORE any page JS
 *    on subsequent navigations, so it wins for new frames.
 *  - For frames that are ALREADY loaded when we attach (connect mode),
 *    we also evaluate it directly. This is a best-effort patch:
 *    listeners registered before we got there are already in the
 *    listener list, so spoofing document.hidden + blocking future
 *    addEventListener calls is the most we can do without page reload.
 */
const KEEP_ACTIVE_SCRIPT = `(function () {
  if ((window).__courseTakerKeepActive) return;
  (window).__courseTakerKeepActive = true;

  try {
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
    Object.defineProperty(document, 'webkitHidden', { get: () => false, configurable: true });
    Object.defineProperty(document, 'webkitVisibilityState', { get: () => 'visible', configurable: true });
    Object.defineProperty(document, 'mozHidden', { get: () => false, configurable: true });
    Object.defineProperty(document, 'msHidden', { get: () => false, configurable: true });
  } catch (e) {}

  try { document.hasFocus = function () { return true; }; } catch (e) {}

  var BLOCKED_TYPES = new Set([
    'visibilitychange',
    'webkitvisibilitychange',
    'mozvisibilitychange',
    'msvisibilitychange',
    'blur',
    'pagehide',
  ]);

  var origAdd = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (BLOCKED_TYPES.has(String(type).toLowerCase())) return;
    return origAdd.call(this, type, listener, options);
  };

  var origDispatch = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (ev) {
    try {
      if (ev && BLOCKED_TYPES.has(String(ev.type).toLowerCase())) return true;
    } catch (e) {}
    return origDispatch.call(this, ev);
  };

  ['onblur', 'onvisibilitychange', 'onwebkitvisibilitychange'].forEach(function (k) {
    try {
      Object.defineProperty(window, k, { get: () => null, set: () => {}, configurable: true });
      Object.defineProperty(document, k, { get: () => null, set: () => {}, configurable: true });
    } catch (e) {}
  });

  setInterval(function () {
    try { window.dispatchEvent(new Event('focus')); } catch (e) {}
    try { document.dispatchEvent(new Event('focus')); } catch (e) {}
  }, 5000);
})();`;

export async function applyKeepActive(page: Page): Promise<void> {
  await page.evaluateOnNewDocument(KEEP_ACTIVE_SCRIPT);

  const frames = page.frames();
  log.info(`Visible frames at attach (${frames.length}):`);
  let patched = 0;
  let failed = 0;
  for (const frame of frames) {
    if (frame.isDetached()) continue;
    const url = frame.url() || "(blank)";
    try {
      await frame.evaluate(KEEP_ACTIVE_SCRIPT);
      patched++;
      log.info(`  [ok]   ${url}`);
    } catch (err) {
      failed++;
      log.warn(`  [fail] ${url} — ${(err as Error).message}`);
    }
  }
  if (failed > 0) {
    log.warn(
      `${failed} frame(s) refused evaluate — they're likely cross-origin and isolated. If this includes the lesson iframe, restart Chrome via start-chrome.ps1 (it now includes --disable-features=IsolateOrigins,site-per-process).`,
    );
  }

  page.on("frameattached", async (frame: Frame) => {
    try {
      await frame.evaluate(KEEP_ACTIVE_SCRIPT);
    } catch {
      /* ignore */
    }
  });
  page.on("framenavigated", async (frame: Frame) => {
    try {
      await frame.evaluate(KEEP_ACTIVE_SCRIPT);
    } catch {
      /* ignore */
    }
  });

  log.info(
    `Keep-active overrides installed (visibility/focus spoofed in ${patched} existing frame(s); applied to all future ones).`,
  );
}

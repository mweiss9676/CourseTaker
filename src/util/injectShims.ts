import type { Frame, Page } from "puppeteer";
import { log } from "./log.js";

/**
 * tsx (and esbuild) wrap inner functions/classes with helpers like
 * __name(fn, "name") and __publicField(obj, key, value). When puppeteer
 * serializes our evaluate callbacks to send to the page, those helper
 * references are baked into the string. The page context doesn't define
 * them, so every evaluate throws "__name is not defined" — silently if the
 * caller doesn't surface the error.
 *
 * Fix: define no-op shims as page globals. We register them via
 * `evaluateOnNewDocument` (so future navigations get them before page JS
 * runs) AND directly evaluate them into every current frame.
 */
const SHIM_SCRIPT = `(function () {
  if (typeof globalThis.__name !== 'function') {
    globalThis.__name = function (target, name) {
      try {
        Object.defineProperty(target, 'name', { value: name, configurable: true });
      } catch (e) {}
      return target;
    };
  }
  if (typeof globalThis.__publicField !== 'function') {
    globalThis.__publicField = function (obj, key, value) {
      Object.defineProperty(obj, key, {
        enumerable: true,
        configurable: true,
        writable: true,
        value: value,
      });
      return value;
    };
  }
  if (typeof globalThis.__defProp !== 'function') {
    globalThis.__defProp = Object.defineProperty;
  }
  if (typeof globalThis.__pow !== 'function') {
    globalThis.__pow = Math.pow;
  }
})();`;

export async function injectShims(page: Page): Promise<void> {
  await page.evaluateOnNewDocument(SHIM_SCRIPT);

  let count = 0;
  let failed = 0;
  for (const frame of page.frames()) {
    if (frame.isDetached()) continue;
    try {
      await frame.evaluate(SHIM_SCRIPT);
      count++;
    } catch (err) {
      failed++;
      log.warn(
        `shim injection failed in ${frame.url()}: ${(err as Error).message}`,
      );
    }
  }
  log.info(
    `Injected esbuild shims into ${count} frame(s)${failed ? ` (${failed} failed)` : ""}.`,
  );

  page.on("frameattached", async (frame: Frame) => {
    try {
      await frame.evaluate(SHIM_SCRIPT);
    } catch {
      /* ignore */
    }
  });
  page.on("framenavigated", async (frame: Frame) => {
    try {
      await frame.evaluate(SHIM_SCRIPT);
    } catch {
      /* ignore */
    }
  });
}

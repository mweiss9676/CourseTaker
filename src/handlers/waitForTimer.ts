import type { Page } from "puppeteer";
import { log } from "../util/log.js";
import { sleep } from "../util/sleep.js";

/**
 * If the most likely "next" button is currently disabled and we can spot a
 * visible countdown / progress indicator, sit and wait instead of clicking
 * something else. Returns true if we waited (caller should retry detection).
 */
export async function waitForTimer(page: Page): Promise<boolean> {
  for (const frame of page.frames()) {
    if (frame.isDetached()) continue;
    try {
      const reason = await frame.evaluate(() => {
        const isVisible = (el: Element): boolean => {
          const he = el as HTMLElement;
          const style = window.getComputedStyle(he);
          if (style.visibility === "hidden" || style.display === "none") {
            return false;
          }
          const rect = he.getBoundingClientRect();
          return rect.width > 2 && rect.height > 2;
        };

        const buttons = Array.from(
          document.querySelectorAll(
            'button, [role="button"], input[type="submit"], input[type="button"]',
          ),
        ) as Array<HTMLElement & { disabled?: boolean }>;

        const reNext = /^(next|continue|proceed|submit|finish|begin)$/i;
        const disabledNext = buttons.find((b) => {
          if (!isVisible(b)) return false;
          const txt = (b.innerText || b.textContent || "").trim();
          if (!reNext.test(txt)) return false;
          return (
            b.disabled === true || b.getAttribute("aria-disabled") === "true"
          );
        });
        if (!disabledNext) return null;

        // Look for any visible countdown or progress indicator in the DOM.
        const all = Array.from(document.body.querySelectorAll("*"));
        for (const el of all) {
          const he = el as HTMLElement;
          if (!isVisible(he)) continue;
          const txt = (he.innerText || "").trim();
          if (
            txt &&
            txt.length < 60 &&
            /(\d{1,2}:\d{2})|(\d+\s*(s|sec|seconds|m|min)\b)/i.test(txt)
          ) {
            return `countdown-text:${txt}`;
          }
          if (
            he.getAttribute("role") === "progressbar" ||
            he.tagName === "PROGRESS"
          ) {
            return "progressbar";
          }
        }
        return null;
      });

      if (reason) {
        log.info(`Timer-gated next button detected (${reason}); waiting 3s`);
        await sleep(3000);
        return true;
      }
    } catch {
      /* ignore */
    }
  }
  return false;
}

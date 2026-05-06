import type { Page } from "puppeteer";
import { log } from "../util/log.js";

/**
 * Handles only the *trivial* quiz cases:
 *   - A single radio group with exactly one option (acknowledgement).
 *   - A single unchecked checkbox that is required to proceed (e.g. "I have
 *     read and understand").
 * Any other quiz layout is left alone — the watchdog will pause for the user.
 *
 * Returns true if it selected something (caller should retry detection so the
 * resulting "Submit" / "Next" can be clicked).
 */
export async function answerQuiz(page: Page): Promise<boolean> {
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
          return rect.width > 0 && rect.height > 0;
        };

        const radios = Array.from(
          document.querySelectorAll('input[type="radio"]'),
        ).filter((el) => isVisible(el)) as HTMLInputElement[];
        if (radios.length > 0) {
          const groups = new Map<string, HTMLInputElement[]>();
          for (const r of radios) {
            const key = r.name || `__anon_${r.id}`;
            const arr = groups.get(key) ?? [];
            arr.push(r);
            groups.set(key, arr);
          }
          let acted = false;
          for (const [, arr] of groups) {
            if (arr.length === 1 && !arr[0]!.checked) {
              arr[0]!.click();
              acted = true;
            }
          }
          if (acted) return "single-option-radio";
        }

        const checks = Array.from(
          document.querySelectorAll('input[type="checkbox"]'),
        ).filter((el) => isVisible(el)) as HTMLInputElement[];
        if (checks.length === 1 && !checks[0]!.checked) {
          const c = checks[0]!;
          const label = (
            c.closest("label")?.textContent ||
            (c.id &&
              document.querySelector(`label[for="${c.id}"]`)?.textContent) ||
            ""
          ).toLowerCase();
          if (
            /agree|understand|acknowledge|read|consent|accept|confirm/.test(
              label,
            )
          ) {
            c.click();
            return "single-acknowledge-checkbox";
          }
        }

        return null;
      });

      if (reason) {
        log.info(`Auto-answered trivial quiz (${reason})`);
        return true;
      }
    } catch {
      /* ignore */
    }
  }
  return false;
}

import type { Page } from "puppeteer";
import type { Config } from "../config.js";
import { log } from "../util/log.js";

const DEFAULT_DISMISS_SELECTORS = [
  '[aria-label="Close"]',
  '[aria-label="close"]',
  'button[title="Close"]',
  ".modal .close",
  '[data-dismiss="modal"]',
  '[data-testid*="close"]',
  '[id*="cookie"] button',
  '[class*="cookie"] button',
];

const DEFAULT_DISMISS_TEXT =
  /^(close|dismiss|no thanks|not now|maybe later|i'?m here|i am here|still here|continue session|stay signed in|accept all|accept|got it|ok|okay)$/i;

/**
 * Walks all frames looking for things that look like dismissable banners /
 * "are you still there?" prompts / cookie banners. Returns true if we
 * dismissed something (caller should restart the click loop).
 */
export async function dismissModals(
  page: Page,
  config: Config,
): Promise<boolean> {
  const configured = config.selectors.dismiss;
  for (const frame of page.frames()) {
    if (frame.isDetached()) continue;
    try {
      const dismissed = await frame.evaluate(
        (args) => {
          const { configured, defaults, textPattern } = args;
          const isVisible = (el: Element): boolean => {
            const he = el as HTMLElement;
            const style = window.getComputedStyle(he);
            if (
              style.visibility === "hidden" ||
              style.display === "none" ||
              style.pointerEvents === "none"
            ) {
              return false;
            }
            const rect = he.getBoundingClientRect();
            return rect.width > 2 && rect.height > 2;
          };

          for (const sel of [...configured, ...defaults]) {
            try {
              const el = document.querySelector(sel) as HTMLElement | null;
              if (el && isVisible(el)) {
                el.click();
                return { reason: `selector:${sel}` };
              }
            } catch {
              /* invalid */
            }
          }

          const re = new RegExp(textPattern.source, textPattern.flags);
          const buttons = Array.from(
            document.querySelectorAll('button, [role="button"], a'),
          ) as HTMLElement[];
          for (const b of buttons) {
            if (!isVisible(b)) continue;
            const txt = (b.innerText || b.textContent || "").trim();
            if (!txt) continue;
            // Only fire on short text to avoid eating real "Continue"/"Next"
            // button which the detector handles separately.
            if (txt.length > 30) continue;
            if (re.test(txt)) {
              // Avoid accepting cookie banners that say just "Continue" — let
              // the main detector handle generic continue. We look at parent
              // context: a "modal" / "dialog" / "banner" ancestor.
              const inDialog = b.closest(
                '[role="dialog"], [role="alertdialog"], .modal, [class*="modal"], [class*="banner"], [id*="cookie"], [class*="cookie"]',
              );
              if (!inDialog) continue;
              b.click();
              return { reason: `text:${txt}` };
            }
          }
          return null;
        },
        {
          configured,
          defaults: DEFAULT_DISMISS_SELECTORS,
          textPattern: {
            source: DEFAULT_DISMISS_TEXT.source,
            flags: DEFAULT_DISMISS_TEXT.flags,
          },
        },
      );
      if (dismissed) {
        log.info(`Dismissed modal/banner (${dismissed.reason})`);
        return true;
      }
    } catch (err) {
      log.debug(`dismissModals frame eval failed`, err);
    }
  }
  return false;
}

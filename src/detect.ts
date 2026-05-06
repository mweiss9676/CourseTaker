import type { ElementHandle, Frame, Page } from "puppeteer";
import type { Config } from "./config.js";
import { log } from "./util/log.js";

export interface Candidate {
  frame: Frame;
  element: ElementHandle<Element>;
  reason: string;
  text: string;
}

const CANDIDATE_SELECTOR = [
  "button",
  'a[href]',
  '[role="button"]',
  'input[type="submit"]',
  'input[type="button"]',
  "[onclick]",
].join(",");

const TARGET_ATTR = "data-coursetaker-target";

/**
 * Tag the best "next-like" candidate inside a given frame.
 * Returns metadata describing what was tagged, or null.
 *
 * Done in-page so we have access to computed styles + accessible names.
 */
async function tagBestCandidateInFrame(
  frame: Frame,
  config: Config,
  configuredSelectors: string[],
): Promise<{ reason: string; text: string } | null> {
  try {
    return await frame.evaluate(
      (args) => {
        const { selectorList, candidateSelector, textRegex, targetAttr } = args;

        document
          .querySelectorAll(`[${targetAttr}]`)
          .forEach((el) => el.removeAttribute(targetAttr));

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
          if (parseFloat(style.opacity || "1") < 0.1) return false;
          const rect = he.getBoundingClientRect();
          if (rect.width < 2 || rect.height < 2) return false;
          if (rect.bottom < 0 || rect.top > window.innerHeight * 5) {
            // very far offscreen; still allow but deprioritize
          }
          return true;
        };

        const isDisabled = (el: Element): boolean => {
          const he = el as HTMLElement & { disabled?: boolean };
          if (he.disabled === true) return true;
          if (he.getAttribute("aria-disabled") === "true") return true;
          const cls = he.className;
          if (
            typeof cls === "string" &&
            /\b(is-)?disabled\b/i.test(cls)
          ) {
            return true;
          }
          return false;
        };

        const accessibleName = (el: Element): string => {
          const he = el as HTMLElement;
          const aria = he.getAttribute("aria-label");
          if (aria && aria.trim()) return aria.trim();
          const labelledby = he.getAttribute("aria-labelledby");
          if (labelledby) {
            const labels = labelledby
              .split(/\s+/)
              .map((id) => document.getElementById(id)?.textContent ?? "")
              .join(" ")
              .trim();
            if (labels) return labels;
          }
          const value = (he as HTMLInputElement).value;
          if (
            (he.tagName === "INPUT" || he.tagName === "BUTTON") &&
            value &&
            value.trim()
          ) {
            return value.trim();
          }
          const title = he.getAttribute("title");
          if (title && title.trim()) return title.trim();
          const text = (he.innerText || he.textContent || "").trim();
          return text;
        };

        for (const sel of selectorList) {
          try {
            const matches = Array.from(document.querySelectorAll(sel));
            for (const el of matches) {
              if (!isVisible(el) || isDisabled(el)) continue;
              el.setAttribute(targetAttr, "1");
              return {
                reason: `config-selector:${sel}`,
                text: accessibleName(el).slice(0, 120),
              };
            }
          } catch {
            /* invalid selector, ignore */
          }
        }

        const re = new RegExp(textRegex, "i");
        const candidates = Array.from(
          document.querySelectorAll(candidateSelector),
        ).filter((el) => isVisible(el) && !isDisabled(el));

        const textHits = candidates
          .map((el) => ({ el, name: accessibleName(el) }))
          .filter(({ name }) => name && re.test(name));

        if (textHits.length > 0) {
          const last = textHits[textHits.length - 1]!;
          last.el.setAttribute(targetAttr, "1");
          return {
            reason: "text-regex",
            text: last.name.slice(0, 120),
          };
        }

        // Last-ditch fallback: lowest-on-page enabled visible button-ish
        // element. Disabled by default to avoid clicking random nav.
        // Enable explicitly in config if wanted.
        return null;
      },
      {
        selectorList: configuredSelectors,
        candidateSelector: CANDIDATE_SELECTOR,
        textRegex: config.nextButtonText,
        targetAttr: TARGET_ATTR,
      },
    );
  } catch (err) {
    log.debug(`Frame eval failed (${frame.url()})`, err);
    return null;
  }
}

export async function findNextCandidate(
  page: Page,
  config: Config,
): Promise<Candidate | null> {
  for (const frame of page.frames()) {
    if (frame.isDetached()) continue;
    const tagged = await tagBestCandidateInFrame(
      frame,
      config,
      config.selectors.next,
    );
    if (!tagged) continue;
    const handle = await frame.$(`[${TARGET_ATTR}]`);
    if (!handle) continue;
    return {
      frame,
      element: handle,
      reason: tagged.reason,
      text: tagged.text,
    };
  }
  return null;
}

/**
 * Cheap "page signature" used for progress detection. URL + main heading +
 * first 200 chars of body text. Different signature => we made progress.
 */
export async function pageSignature(page: Page): Promise<string> {
  try {
    const sig = await page.evaluate(() => {
      const h =
        document.querySelector("h1, h2, [role='heading']")?.textContent ?? "";
      const body =
        (document.body?.innerText || document.body?.textContent || "").slice(
          0,
          200,
        ) ?? "";
      return `${location.href}|${h.trim()}|${body.trim()}`;
    });
    return sig;
  } catch {
    return `${page.url()}|err`;
  }
}

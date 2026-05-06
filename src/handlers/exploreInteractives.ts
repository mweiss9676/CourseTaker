import type { Page } from "puppeteer";
import { log } from "../util/log.js";
import { humanDelay } from "../util/sleep.js";

/**
 * Tier-1 "dark pattern gate" handler.
 *
 * Many courses gate the Next button behind "click each of these N icons /
 * tabs / flip-cards / hotspots first". The Next button isn't visible at all
 * until you've interacted with everything. This explorer walks the page
 * looking for content-area interactives we haven't clicked yet and clicks
 * one per call. The run loop calls us when no Next-button candidate has
 * been found for a few seconds.
 *
 * Two-mode operation:
 *  - conservative: only obvious hotspots (numbered, icon-only, role=tab,
 *    classes mentioning "hotspot/marker/interactive/tab/card").
 *  - aggressive: any visible interactive with a short label that isn't on
 *    the deny list. Used only after conservative is exhausted.
 *
 * State (mode + which page we're on) is per-page-signature so a new lesson
 * page starts fresh.
 */

const CLICKED_ATTR = "data-coursetaker-clicked";

const DEFAULT_CONTENT_DENY_ANCESTORS = [
  "header",
  "nav",
  "aside",
  '[role="banner"]',
  '[role="navigation"]',
  '[role="complementary"]',
  '[role="menubar"]',
  '[data-testid="top-bar"]',
  '[data-testid="bottom-drawer"]',
  '[data-testid="bottom-bar"]',
  "#bottomDrawer",
  "#overviewButton",
];

const NAME_DENY_PATTERN =
  "^(menu|help|settings|close|exit|language|fullscreen|transcript|share|save|dashboard|home|profile|logout|search|sound|mute|volume|captions|subtitles|replay|restart|expand|collapse|skip|previous|back|overview|rate|rate this|feedback|report|report issue|report a problem|report a bug)$";

const HOTSPOT_HINT_PATTERN =
  "(hotspot|marker|interactive|pressable|clickable|^tab(\\b|-|_)|card-|flip)";

const CANDIDATE_SELECTOR = [
  "button",
  "a[href]",
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[tabindex="0"]',
  "[onclick]",
].join(",");

type Mode = "conservative" | "aggressive";

export class Explorer {
  private lastSig = "";
  private mode: Mode = "conservative";
  private denyAncestors: string;

  constructor(extraDenySelectors: string[] = []) {
    this.denyAncestors = [
      ...DEFAULT_CONTENT_DENY_ANCESTORS,
      ...extraDenySelectors,
    ].join(",");
  }

  resetForPage(sig: string): void {
    if (sig !== this.lastSig) {
      this.lastSig = sig;
      this.mode = "conservative";
    }
  }

  async tryClickOne(page: Page): Promise<boolean> {
    const result = await this.passOnce(page, this.mode);
    if (result) {
      log.info(
        `Explore [${this.mode}]: clicked "${result.name}" (${result.reason})`,
      );
      await humanDelay(400, 900);
      return true;
    }

    if (this.mode === "conservative") {
      log.info(
        "Explore: conservative pass found nothing; switching to aggressive.",
      );
      this.mode = "aggressive";
      return this.tryClickOne(page);
    }

    return false;
  }

  private async passOnce(
    page: Page,
    mode: Mode,
  ): Promise<{ name: string; reason: string } | null> {
    for (const frame of page.frames()) {
      if (frame.isDetached()) continue;
      const fUrl = frame.url() || "(blank)";
      try {
        const result = await frame.evaluate(
          (args) => {
            const {
              mode,
              clickedAttr,
              denyAncestors,
              denyNamePattern,
              hotspotPattern,
              candidateSelector,
            } = args;

            const denyNameRe = new RegExp(denyNamePattern, "i");
            const hotspotRe = new RegExp(hotspotPattern, "i");

            const isVisible = (el: Element): boolean => {
              const he = el as HTMLElement;
              const style = window.getComputedStyle(he);
              if (
                style.visibility === "hidden" ||
                style.display === "none" ||
                style.pointerEvents === "none"
              )
                return false;
              if (parseFloat(style.opacity || "1") < 0.1) return false;
              const rect = he.getBoundingClientRect();
              if (rect.width < 4 || rect.height < 4) return false;
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
              )
                return true;
              return false;
            };

            const accessibleName = (el: Element): string => {
              const he = el as HTMLElement;
              const aria = he.getAttribute("aria-label");
              if (aria && aria.trim()) return aria.trim();
              const txt = (he.innerText || he.textContent || "").trim();
              if (txt) return txt;
              const title = he.getAttribute("title");
              if (title && title.trim()) return title.trim();
              const svg = he.querySelector("svg");
              if (svg) {
                const svgTitleAttr = svg.getAttribute("title");
                if (svgTitleAttr && svgTitleAttr.trim()) {
                  return svgTitleAttr.trim();
                }
                const svgTitleEl = svg.querySelector("title");
                const svgTitleText = svgTitleEl?.textContent?.trim();
                if (svgTitleText) return svgTitleText;
              }
              return "";
            };

            const explicit = Array.from(
              document.querySelectorAll(candidateSelector),
            );

            const explicitSet = new Set(explicit);
            const cursorCandidates: Element[] = [];
            const all = document.querySelectorAll("body *");
            for (const el of all) {
              if (explicitSet.has(el)) continue;
              if (el.children.length > 8) continue;
              try {
                const cs = window.getComputedStyle(el as HTMLElement);
                if (cs.cursor === "pointer") {
                  cursorCandidates.push(el);
                }
              } catch {
                /* ignore */
              }
            }

            const candidates = [...explicit, ...cursorCandidates];

            for (const el of candidates) {
              if (el.hasAttribute(clickedAttr)) continue;
              if (!isVisible(el) || isDisabled(el)) continue;
              if (el.closest(denyAncestors)) continue;

              const name = accessibleName(el);
              if (name && denyNameRe.test(name)) continue;

              const cls =
                typeof el.className === "string" ? el.className : "";
              const id = el.getAttribute("id") || "";

              let qualifies = false;
              let reason = "";

              const visibleText = (
                (el as HTMLElement).innerText ||
                el.textContent ||
                ""
              ).trim();

              if (name && /^[0-9]{1,2}$/.test(name)) {
                qualifies = true;
                reason = `numbered:${name}`;
              } else if (/^[0-9]{1,2}$/.test(visibleText)) {
                qualifies = true;
                reason = `numbered-text:${visibleText}`;
              } else if (
                hotspotRe.test(cls) ||
                hotspotRe.test(id) ||
                el.getAttribute("role") === "tab" ||
                el.getAttribute("role") === "menuitem"
              ) {
                qualifies = true;
                reason = `hotspot/${el.getAttribute("role") || cls.slice(0, 40)}`;
              } else if (mode === "aggressive" && name && name.length < 40) {
                qualifies = true;
                reason = `aggressive:${name.slice(0, 30)}`;
              }

              if (!qualifies) continue;

              el.setAttribute(clickedAttr, "1");
              try {
                (el as HTMLElement).scrollIntoView({
                  block: "center",
                  inline: "center",
                });
              } catch {
                /* ignore */
              }
              try {
                (el as HTMLElement).click();
              } catch {
                /* ignore */
              }
              return { name: name.slice(0, 80) || "(unnamed)", reason };
            }
            return null;
          },
          {
            mode,
            clickedAttr: CLICKED_ATTR,
            denyAncestors: this.denyAncestors,
            denyNamePattern: NAME_DENY_PATTERN,
            hotspotPattern: HOTSPOT_HINT_PATTERN,
            candidateSelector: CANDIDATE_SELECTOR,
          },
        );
        if (result) return result;
      } catch (err) {
        log.warn(
          `explore: frame eval failed in ${fUrl}: ${(err as Error).message}`,
        );
      }
    }
    return null;
  }
}

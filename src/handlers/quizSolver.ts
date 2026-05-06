import type { Page } from "puppeteer";
import { log } from "../util/log.js";

/**
 * Tier-1 quiz handler for *real* multiple-choice quizzes.
 *
 * For most compliance/training courses the goal isn't to know the right
 * answer — wrong answers just show "try again" and let you retry forever.
 * So we just enumerate options. Worst case ~4 attempts per question.
 *
 * State: per-question (keyed by the option labels) Set of tried option
 * indices. Persists across page navigations because the same question may
 * reappear on a different "page" after a wrong submit.
 *
 * Flow per call:
 *   1. Find the first visible radio group with >= 2 options in any frame.
 *   2. Treat the currently-checked option as already tried (whether we
 *      checked it last round or the platform pre-selected it).
 *   3. Pick the next untried option index.
 *   4. Click the radio + click a "Submit"-like button nearby if there is
 *      one. Return true so the run loop restarts.
 *   5. If every option has been tried for this question, return false so
 *      the run loop's stall watchdog eventually pauses for the user.
 *
 * Note: trivial "single-option / I-agree checkbox" cases stay handled by
 * the existing `answerQuiz.ts` because that's a different shape.
 */

interface QuizInfo {
  fingerprint: string;
  groupName: string;
  questionText: string;
  optionLabels: string[];
  optionCount: number;
  currentSelection: number;
}

const SUBMIT_REGEX = "^(submit|check|check answer|verify|confirm answer|answer|done)$";

export class QuizSolver {
  private tried: Map<string, Set<number>> = new Map();

  async tryAnswer(page: Page): Promise<boolean> {
    for (const frame of page.frames()) {
      if (frame.isDetached()) continue;

      let info: QuizInfo | null = null;
      try {
        info = (await frame.evaluate(() => {
          const isVisible = (el: Element): boolean => {
            const he = el as HTMLElement;
            const style = window.getComputedStyle(he);
            if (
              style.visibility === "hidden" ||
              style.display === "none" ||
              style.pointerEvents === "none"
            )
              return false;
            const rect = he.getBoundingClientRect();
            return rect.width > 2 && rect.height > 2;
          };

          const radios = Array.from(
            document.querySelectorAll('input[type="radio"]'),
          ).filter(
            (el) =>
              isVisible(el) &&
              !(el as HTMLInputElement).disabled &&
              el.getAttribute("aria-disabled") !== "true",
          ) as HTMLInputElement[];

          if (radios.length < 2) return null;

          const groups = new Map<string, HTMLInputElement[]>();
          for (const r of radios) {
            const key = r.name && r.name.trim() ? r.name : "__anon";
            const arr = groups.get(key) ?? [];
            arr.push(r);
            groups.set(key, arr);
          }

          let chosenName: string | null = null;
          let chosenOptions: HTMLInputElement[] | null = null;
          for (const [name, arr] of groups) {
            if (arr.length >= 2 && name !== "__anon") {
              chosenName = name;
              chosenOptions = arr;
              break;
            }
          }
          if (!chosenName || !chosenOptions) return null;

          const optionLabels = chosenOptions.map((r) => {
            const inLabel = r.closest("label")?.textContent?.trim() ?? "";
            const forLabel =
              (r.id &&
                document
                  .querySelector(`label[for="${r.id}"]`)
                  ?.textContent?.trim()) ||
              "";
            return (inLabel || forLabel || r.value || "").slice(0, 120);
          });

          let currentSelection = -1;
          for (let i = 0; i < chosenOptions.length; i++) {
            if (chosenOptions[i]!.checked) {
              currentSelection = i;
              break;
            }
          }

          let questionText = "";
          const fs = chosenOptions[0]!.closest("fieldset");
          const legend = fs?.querySelector("legend");
          if (legend) {
            questionText = (legend.textContent || "").trim();
          }
          if (!questionText) {
            let p: HTMLElement | null = chosenOptions[0]!.parentElement;
            for (let depth = 0; depth < 6 && p && !questionText; depth++) {
              const txt = (p.innerText || p.textContent || "").trim();
              if (txt.length > 15) {
                let q = txt;
                for (const ol of optionLabels) {
                  if (ol) q = q.split(ol).join(" ");
                }
                questionText = q.replace(/\s+/g, " ").trim().slice(0, 200);
              }
              p = p.parentElement;
            }
          }

          const fingerprint = `${chosenName}::${optionLabels.join("|")}`;

          return {
            fingerprint,
            groupName: chosenName,
            questionText,
            optionLabels,
            optionCount: chosenOptions.length,
            currentSelection,
          } satisfies QuizInfo;
        })) as QuizInfo | null;
      } catch (err) {
        log.debug("quiz info eval failed", err);
        continue;
      }

      if (!info) continue;

      let tried = this.tried.get(info.fingerprint);
      if (!tried) {
        tried = new Set<number>();
        this.tried.set(info.fingerprint, tried);
      }
      if (info.currentSelection >= 0) tried.add(info.currentSelection);

      let next = -1;
      for (let i = 0; i < info.optionCount; i++) {
        if (!tried.has(i)) {
          next = i;
          break;
        }
      }

      if (next === -1) {
        log.warn(
          `Quiz: tried all ${info.optionCount} options for "${info.questionText.slice(0, 80)}". Falling through — pause for manual help.`,
        );
        continue;
      }

      let success = false;
      try {
        success = (await frame.evaluate(
          (args) => {
            const { groupName, optionIndex, submitRegex } = args;
            const allRadios = Array.from(
              document.querySelectorAll('input[type="radio"]'),
            ) as HTMLInputElement[];
            const opts = allRadios.filter((r) => r.name === groupName);
            const target = opts[optionIndex];
            if (!target) return false;

            const label =
              target.closest("label") ||
              (target.id
                ? document.querySelector<HTMLLabelElement>(
                    `label[for="${target.id}"]`,
                  )
                : null);
            try {
              if (label) (label as HTMLElement).click();
              else target.click();
            } catch {
              target.click();
            }

            const isVisible = (el: Element): boolean => {
              const he = el as HTMLElement;
              const style = window.getComputedStyle(he);
              if (style.visibility === "hidden" || style.display === "none")
                return false;
              const rect = he.getBoundingClientRect();
              return rect.width > 2 && rect.height > 2;
            };

            const re = new RegExp(submitRegex, "i");
            const scope =
              target.closest("form, fieldset, [role='form'], [class*='quiz'], [class*='question']") ||
              document.body;
            const buttons = Array.from(
              scope.querySelectorAll(
                'button, [role="button"], input[type="submit"], input[type="button"]',
              ),
            ) as HTMLElement[];
            for (const b of buttons) {
              if (!isVisible(b)) continue;
              if ((b as HTMLButtonElement).disabled) continue;
              if (b.getAttribute("aria-disabled") === "true") continue;
              const txt = (
                b.getAttribute("aria-label") ||
                (b as HTMLInputElement).value ||
                b.innerText ||
                b.textContent ||
                ""
              ).trim();
              if (re.test(txt)) {
                b.click();
                return true;
              }
            }
            return true;
          },
          {
            groupName: info.groupName,
            optionIndex: next,
            submitRegex: SUBMIT_REGEX,
          },
        )) as boolean;
      } catch (err) {
        log.debug("quiz click eval failed", err);
      }

      if (success) {
        tried.add(next);
        const label = info.optionLabels[next] ?? `option#${next}`;
        log.info(
          `Quiz: tried "${label.slice(0, 60)}" for "${info.questionText.slice(0, 60)}" (attempt ${tried.size}/${info.optionCount})`,
        );
        return true;
      }
    }
    return false;
  }
}

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Browser, Page } from "puppeteer";
import type { Config } from "./config.js";
import { findNextCandidate, pageSignature } from "./detect.js";
import { dismissModals } from "./handlers/dismissModals.js";
import { waitForTimer } from "./handlers/waitForTimer.js";
import { playMedia } from "./handlers/playMedia.js";
import { answerQuiz } from "./handlers/answerQuiz.js";
import { QuizSolver } from "./handlers/quizSolver.js";
import { Explorer } from "./handlers/exploreInteractives.js";
import { log } from "./util/log.js";
import { humanDelay, sleep } from "./util/sleep.js";
import { onEnter, PauseController, startEnterWatcher } from "./util/keys.js";
import { dumpFrames } from "./util/dumpFrames.js";
import { anyMediaPlaying } from "./util/mediaState.js";

export interface RunArgs {
  browser: Browser;
  page: Page;
  config: Config;
}

export async function runCourse(args: RunArgs): Promise<void> {
  const { page, config } = args;

  const runDir = resolve(
    process.cwd(),
    "runs",
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  await mkdir(runDir, { recursive: true });
  log.info(`Run artifacts in: ${runDir}`);

  const pause = new PauseController();
  startEnterWatcher();
  onEnter(() => {
    const nowPaused = pause.toggle();
    log.warn(nowPaused ? "PAUSED (press ENTER to resume)" : "RESUMED");
  });

  let clicks = 0;
  let lastSig = await pageSignature(page);
  let lastProgressAt = Date.now();
  let stallScreenshots = 0;
  let noCandidateSince: number | null = null;
  let warnedNoCandidate = false;

  const stallTimeoutMs = config.limits.stallTimeoutSec * 1000;
  const noCandidateExploreMs = 5_000;
  const noCandidateWarnMs = 12_000;
  const noCandidatePauseMs = 30_000;

  const explorer = new Explorer(config.selectors.deny);
  const quiz = new QuizSolver();

  while (clicks < config.limits.maxClicks) {
    await pause.waitIfPaused();

    if (await isStopCondition(page, config)) {
      log.info("Stop condition reached. Exiting loop.");
      return;
    }

    if (await dismissModals(page, config)) {
      await sleep(400);
      continue;
    }

    if (await playMedia(page, config)) {
      // No need to continue — we don't want autoplay to block clicking the
      // next button. Fall through to detection.
    }

    if (await waitForTimer(page)) {
      continue;
    }

    if (await answerQuiz(page)) {
      await sleep(400);
      continue;
    }

    if (await quiz.tryAnswer(page)) {
      await sleep(config.limits.postClickWaitMs);
      const newSig = await pageSignature(page);
      if (newSig !== lastSig) {
        lastSig = newSig;
        lastProgressAt = Date.now();
      }
      continue;
    }

    const candidate = await findNextCandidate(page, config);
    if (!candidate) {
      if (noCandidateSince === null) noCandidateSince = Date.now();
      const noCandFor = Date.now() - noCandidateSince;

      if (noCandFor > noCandidateExploreMs) {
        explorer.resetForPage(lastSig);
        const explored = await explorer.tryClickOne(page);
        if (explored) {
          await sleep(config.limits.postClickWaitMs);
          const newSig = await pageSignature(page);
          if (newSig !== lastSig) {
            lastSig = newSig;
            lastProgressAt = Date.now();
          }
          continue;
        }
      }

      if (await anyMediaPlaying(page)) {
        noCandidateSince = Date.now();
        warnedNoCandidate = false;
        lastProgressAt = Date.now();
        await sleep(2000);
        continue;
      }

      if (!warnedNoCandidate && noCandFor > noCandidateWarnMs) {
        warnedNoCandidate = true;
        log.warn(
          "Nothing obvious to click and explorer found nothing more. If this page needs you to do something specific (drag items, answer a question), do it now — I'll pick up the Next button automatically.",
        );
      }

      const stalled =
        noCandFor > noCandidatePauseMs ||
        Date.now() - lastProgressAt > stallTimeoutMs;
      if (stalled) {
        stallScreenshots++;
        const path = resolve(runDir, `stall-${stallScreenshots}.png`);
        try {
          await page.screenshot({ path: path as `${string}.png`, fullPage: true });
          log.warn(`Still stuck. Screenshot: ${path}`);
        } catch (err) {
          log.warn("Stalled; screenshot failed.", err);
        }
        try {
          await dumpFrames(page, runDir, `stall${stallScreenshots}`);
        } catch (err) {
          log.warn("Frame dump failed.", err);
        }
        log.warn(
          "PAUSED. Take action in the browser, then press ENTER to resume.",
        );
        process.stdout.write("\x07");
        if (!pause.isPaused()) pause.toggle();
        await pause.waitIfPaused();
        lastProgressAt = Date.now();
        noCandidateSince = null;
        warnedNoCandidate = false;
        continue;
      }
      await sleep(1500);
      continue;
    }

    noCandidateSince = null;
    warnedNoCandidate = false;

    log.info(
      `Click #${clicks + 1} -> "${candidate.text}" (${candidate.reason})`,
    );

    try {
      await candidate.element.scrollIntoView().catch(() => {});
      await humanDelay(
        config.limits.minClickDelayMs,
        config.limits.maxClickDelayMs,
      );
      await candidate.element.click({ delay: 30 }).catch(async (err) => {
        log.warn("Native click failed, falling back to JS click", err);
        await candidate.frame.evaluate((el) => {
          (el as HTMLElement).click();
        }, candidate.element);
      });
    } catch (err) {
      log.warn("Click failed entirely", err);
    } finally {
      try {
        await candidate.element.dispose();
      } catch {
        /* ignore */
      }
    }

    clicks++;

    await sleep(config.limits.postClickWaitMs);

    const newSig = await pageSignature(page);
    if (newSig !== lastSig) {
      lastSig = newSig;
      lastProgressAt = Date.now();
      log.debug("Progress detected (signature changed)");
    } else if (Date.now() - lastProgressAt > stallTimeoutMs) {
      stallScreenshots++;
      const path = resolve(runDir, `stall-${stallScreenshots}.png`);
      try {
        await page.screenshot({
          path: path as `${string}.png`,
          fullPage: true,
        });
      } catch {
        /* ignore */
      }
      log.warn(
        `No progress for ${config.limits.stallTimeoutSec}s. Screenshot: ${path}. Pausing — press ENTER to resume.`,
      );
      process.stdout.write("\x07");
      if (!pause.isPaused()) pause.toggle();
      await pause.waitIfPaused();
      lastProgressAt = Date.now();
    }
  }

  log.warn(
    `Hit max clicks (${config.limits.maxClicks}). Stopping to avoid runaway loops.`,
  );
}

async function isStopCondition(
  page: Page,
  config: Config,
): Promise<boolean> {
  const { urlContains, textContains } = config.stopWhen;
  if (urlContains && page.url().includes(urlContains)) return true;
  if (textContains) {
    try {
      const found = await page.evaluate((needle) => {
        return (document.body?.innerText || "").includes(needle);
      }, textContains);
      if (found) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

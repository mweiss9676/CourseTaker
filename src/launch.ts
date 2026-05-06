import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import puppeteer, { Browser, Page } from "puppeteer";
import type { Config } from "./config.js";
import { log } from "./util/log.js";

export interface LaunchResult {
  browser: Browser;
  page: Page;
}

export async function launchBrowser(config: Config): Promise<LaunchResult> {
  const userDataDir = resolve(process.cwd(), config.userDataDir);
  await mkdir(userDataDir, { recursive: true });

  log.info(`Launching Chrome with profile at ${userDataDir}`);
  const browser = await puppeteer.launch({
    headless: false,
    userDataDir,
    defaultViewport: null,
    args: [
      "--start-maximized",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
      "--disable-features=IsolateOrigins,site-per-process",
    ],
  });

  const pages = await browser.pages();
  const page = pages[0] ?? (await browser.newPage());

  await page.setViewport({ width: 0, height: 0 });

  log.info(`Navigating to course URL: ${config.courseUrl}`);
  try {
    await page.goto(config.courseUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
  } catch (err) {
    log.warn("Initial navigation didn't fully settle; continuing anyway.", err);
  }

  return { browser, page };
}

export function waitForUserConfirm(prompt: string): Promise<void> {
  return new Promise((resolve) => {
    process.stdout.write(`\n${prompt}\n> `);
    const onData = (chunk: Buffer) => {
      const s = chunk.toString();
      if (s.includes("\n") || s.includes("\r")) {
        process.stdin.off("data", onData);
        process.stdin.pause();
        resolve();
      }
    };
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

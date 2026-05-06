import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import vanillaPuppeteer, { Browser, Page } from "puppeteer";
import type { Config } from "./config.js";
import { log } from "./util/log.js";
import { applyKeepActive } from "./keepActive.js";
import { injectShims } from "./util/injectShims.js";

puppeteer.use(StealthPlugin());

export interface LaunchResult {
  browser: Browser;
  page: Page;
  isConnect: boolean;
}

export async function launchBrowser(config: Config): Promise<LaunchResult> {
  if (config.browser.mode === "connect") {
    return connectBrowser(config);
  }
  return launchOwnedBrowser(config);
}

async function launchOwnedBrowser(config: Config): Promise<LaunchResult> {
  const userDataDir = resolve(process.cwd(), config.userDataDir);
  await mkdir(userDataDir, { recursive: true });

  log.info(`Launching Chrome with profile at ${userDataDir}`);
  const browser = (await puppeteer.launch({
    headless: false,
    userDataDir,
    defaultViewport: null,
    ignoreDefaultArgs: ["--enable-automation"],
    args: [
      "--start-maximized",
      "--disable-blink-features=AutomationControlled",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
      "--disable-features=IsolateOrigins,site-per-process",
      "--no-default-browser-check",
      "--no-first-run",
    ],
  })) as unknown as Browser;

  const pages = await browser.pages();
  const page = pages[0] ?? (await browser.newPage());

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  await injectShims(page);
  await applyKeepActive(page);

  log.info(
    `Browser ready (LAUNCH mode). NOT auto-navigating — drive to the course yourself.`,
  );
  log.info(`(Configured courseUrl: ${config.courseUrl})`);

  return { browser, page, isConnect: false };
}

async function connectBrowser(config: Config): Promise<LaunchResult> {
  log.info(`CONNECT mode — attaching to existing Chrome at ${config.browser.connectUrl}`);
  log.info(`If this fails, make sure you started Chrome with:`);
  log.info(`  chrome.exe --remote-debugging-port=9222 --user-data-dir=C:\\chrome-coursetaker`);

  const browser = (await vanillaPuppeteer.connect({
    browserURL: config.browser.connectUrl,
    defaultViewport: null,
  })) as Browser;

  const allPages = await browser.pages();
  if (allPages.length === 0) {
    throw new Error("Connected browser has no open pages.");
  }

  const realPages = allPages.filter((p) => {
    const url = p.url();
    return (
      !url.startsWith("chrome://") &&
      !url.startsWith("chrome-extension://") &&
      !url.startsWith("devtools://") &&
      !url.startsWith("edge://")
    );
  });

  if (realPages.length === 0) {
    throw new Error(
      `No real tabs open in the connected Chrome. Saw only internal pages: ${allPages
        .map((p) => p.url())
        .join(", ")}`,
    );
  }

  let host = "";
  try {
    host = new URL(config.courseUrl).host;
  } catch {
    /* invalid courseUrl — that's OK, just don't match by host */
  }

  let page: Page | undefined;
  if (host) {
    page = realPages.find((p) => {
      try {
        return new URL(p.url()).host.endsWith(host);
      } catch {
        return false;
      }
    });
    if (page) {
      log.info(`Attached to course tab by URL host match: ${page.url()}`);
    }
  }
  if (!page) {
    page = realPages[0]!;
    if (realPages.length > 1) {
      log.warn(
        `${realPages.length} non-internal tabs; using first (${page.url()}). Tip: bring the lesson tab to the front or set its URL host in courseUrl.`,
      );
    } else {
      log.info(`Attached to tab: ${page.url()}`);
    }
  }

  await injectShims(page);
  await applyKeepActive(page);

  log.info(`Connected. NOT touching anything until you press ENTER.`);
  return { browser, page, isConnect: true };
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

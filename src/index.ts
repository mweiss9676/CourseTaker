import { loadConfig } from "./config.js";
import { launchBrowser, waitForUserConfirm } from "./launch.js";
import { log } from "./util/log.js";
import { runCourse } from "./run.js";

async function main(): Promise<void> {
  const config = await loadConfig();
  const { browser, page, isConnect } = await launchBrowser(config);

  process.on("SIGINT", async () => {
    log.warn("SIGINT received...");
    try {
      if (isConnect) {
        await browser.disconnect();
      } else {
        await browser.close();
      }
    } catch {
      /* ignore */
    }
    process.exit(0);
  });

  await waitForUserConfirm(
    [
      "============================================================",
      "  Browser is open and IDLE. The script will NOT click or",
      "  navigate anywhere until you press ENTER below.",
      "",
      "  In the browser, do these in order:",
      "    1. Type the URL into the address bar yourself and sign in",
      "       (CAPTCHAs hate page.goto from a fresh session).",
      "    2. Navigate to the lesson you want auto-completed.",
      "    3. Make sure the page is fully loaded and visible.",
      "    4. Come back here and press ENTER to start clicking.",
      "",
      "  Once running, ENTER pauses/resumes. Ctrl+C quits.",
      "============================================================",
    ].join("\n"),
  );

  try {
    await runCourse({ browser, page, config });
  } catch (err) {
    log.error("Run failed", err);
  } finally {
    log.info("Done. Browser left open so you can inspect the final state.");
    log.info("Press Ctrl+C to close.");
    await new Promise(() => {});
  }
}

main().catch((err) => {
  log.error("Fatal", err);
  process.exit(1);
});

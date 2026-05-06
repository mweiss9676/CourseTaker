import { loadConfig } from "./config.js";
import { launchBrowser, waitForUserConfirm } from "./launch.js";
import { log } from "./util/log.js";
import { runCourse } from "./run.js";

async function main(): Promise<void> {
  const config = await loadConfig();
  const { browser, page } = await launchBrowser(config);

  process.on("SIGINT", async () => {
    log.warn("SIGINT received, closing browser...");
    try {
      await browser.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  });

  await waitForUserConfirm(
    [
      "============================================================",
      "  Browser is open. Do these things, then press ENTER:",
      "    1. Sign in to the course platform.",
      "    2. Navigate to the lesson you want auto-completed.",
      "    3. Make sure the page is fully loaded.",
      "  Press ENTER again at any time to PAUSE/RESUME automation.",
      "  Ctrl+C to quit.",
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

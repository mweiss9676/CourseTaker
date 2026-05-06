import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Page } from "puppeteer";
import { log } from "./log.js";

function sanitize(s: string): string {
  return s
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 80);
}

/**
 * Writes each frame's <body> outerHTML and a short candidate-summary to
 * runDir, so the user can share them when the explorer can't find
 * anything to click.
 */
export async function dumpFrames(
  page: Page,
  runDir: string,
  tag: string,
): Promise<void> {
  const frames = page.frames();
  log.info(`Dumping ${frames.length} frame(s) to ${runDir} (tag=${tag})`);
  let i = 0;
  for (const frame of frames) {
    i++;
    if (frame.isDetached()) continue;
    const url = frame.url() || "blank";
    const fname = `frame-${tag}-${String(i).padStart(2, "0")}-${sanitize(url)}`;
    try {
      const data = await frame.evaluate(() => {
        const isVisible = (el: Element): boolean => {
          const he = el as HTMLElement;
          const style = window.getComputedStyle(he);
          if (style.visibility === "hidden" || style.display === "none")
            return false;
          const r = he.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const all = Array.from(document.body?.querySelectorAll("*") ?? []);
        const cursorPointer: { tag: string; text: string; cls: string }[] = [];
        const explicit: { tag: string; text: string; cls: string }[] = [];
        const explicitSelector =
          'button, a[href], [role="button"], [role="tab"], [role="menuitem"], [tabindex], [onclick]';
        for (const el of all) {
          if (!isVisible(el)) continue;
          const he = el as HTMLElement;
          const txt = (he.innerText || he.textContent || "")
            .trim()
            .slice(0, 60);
          const cls =
            typeof el.className === "string"
              ? el.className.slice(0, 80)
              : "";
          const isExp = el.matches(explicitSelector);
          if (isExp) {
            explicit.push({ tag: el.tagName, text: txt, cls });
          }
          try {
            if (window.getComputedStyle(he).cursor === "pointer") {
              cursorPointer.push({ tag: el.tagName, text: txt, cls });
            }
          } catch {
            /* ignore */
          }
        }
        return {
          html: document.body?.outerHTML ?? "",
          title: document.title,
          url: location.href,
          counts: {
            total: all.length,
            explicit: explicit.length,
            cursorPointer: cursorPointer.length,
          },
          explicit: explicit.slice(0, 40),
          cursorPointer: cursorPointer.slice(0, 40),
        };
      });

      await writeFile(resolve(runDir, `${fname}.html`), data.html, "utf8");
      const summary = [
        `frame: ${url}`,
        `title: ${data.title}`,
        `total visible elements: ${data.counts.total}`,
        `explicit candidates (button/a/role/tabindex/onclick): ${data.counts.explicit}`,
        `cursor:pointer elements: ${data.counts.cursorPointer}`,
        ``,
        `--- first 40 explicit candidates ---`,
        ...data.explicit.map(
          (c) => `  <${c.tag}> "${c.text}" .${c.cls}`,
        ),
        ``,
        `--- first 40 cursor:pointer elements ---`,
        ...data.cursorPointer.map(
          (c) => `  <${c.tag}> "${c.text}" .${c.cls}`,
        ),
      ].join("\n");
      await writeFile(resolve(runDir, `${fname}.summary.txt`), summary, "utf8");
      log.info(
        `  dumped frame #${i}: ${url} (explicit=${data.counts.explicit}, cursor=${data.counts.cursorPointer})`,
      );
    } catch (err) {
      log.warn(
        `  failed to dump frame #${i} (${url}): ${(err as Error).message}`,
      );
    }
  }
}

import type { Page } from "puppeteer";
import type { Config } from "../config.js";
import { log } from "../util/log.js";

/**
 * Make sure any visible <video>/<audio> on the page is playing. Returns true
 * if we kicked something off (caller can keep looping; this handler is
 * idempotent so returning false next time is normal).
 */
export async function playMedia(
  page: Page,
  config: Config,
): Promise<boolean> {
  if (!config.video.autoplay) return false;
  let acted = false;
  for (const frame of page.frames()) {
    if (frame.isDetached()) continue;
    try {
      const result = await frame.evaluate(
        async (opts) => {
          const media = Array.from(
            document.querySelectorAll("video, audio"),
          ) as HTMLMediaElement[];
          let started = 0;
          for (const m of media) {
            try {
              if (opts.muted) m.muted = true;
              if (m.playbackRate !== opts.playbackRate) {
                m.playbackRate = opts.playbackRate;
              }
              if (m.paused && !m.ended) {
                await m.play().catch(() => {});
                started++;
              }
            } catch {
              /* ignore */
            }
          }
          return { mediaCount: media.length, started };
        },
        { playbackRate: config.video.playbackRate, muted: config.video.muted },
      );
      if (result.started > 0) {
        log.debug(
          `Started ${result.started}/${result.mediaCount} media element(s) in frame`,
        );
        acted = true;
      }
    } catch {
      /* ignore */
    }
  }
  return acted;
}

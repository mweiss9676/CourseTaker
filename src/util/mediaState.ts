import type { Page } from "puppeteer";

/**
 * Returns true if any visible <audio>/<video> in any frame is currently
 * playing (not paused, not ended, currentTime > 0). Used to suppress the
 * stall watchdog while a hotspot's narration audio is playing.
 */
export async function anyMediaPlaying(page: Page): Promise<boolean> {
  for (const frame of page.frames()) {
    if (frame.isDetached()) continue;
    try {
      const playing = await frame.evaluate(() => {
        const media = Array.from(
          document.querySelectorAll("audio, video"),
        ) as HTMLMediaElement[];
        return media.some(
          (m) => !m.paused && !m.ended && m.currentTime > 0,
        );
      });
      if (playing) return true;
    } catch {
      /* ignore; cross-origin or detached */
    }
  }
  return false;
}

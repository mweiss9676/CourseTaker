import { log } from "./log.js";

type EnterListener = () => void;

let listeners: EnterListener[] = [];
let started = false;

export function startEnterWatcher(): void {
  if (started) return;
  started = true;
  process.stdin.resume();
  process.stdin.on("data", (chunk: Buffer) => {
    const s = chunk.toString();
    if (s.includes("\n") || s.includes("\r")) {
      for (const fn of [...listeners]) {
        try {
          fn();
        } catch (err) {
          log.error("Enter listener threw", err);
        }
      }
    }
  });
}

export function onEnter(fn: EnterListener): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

export class PauseController {
  private paused = false;
  private waiters: Array<() => void> = [];

  toggle(): boolean {
    this.paused = !this.paused;
    if (!this.paused) {
      const w = this.waiters;
      this.waiters = [];
      for (const fn of w) fn();
    }
    return this.paused;
  }

  isPaused(): boolean {
    return this.paused;
  }

  waitIfPaused(): Promise<void> {
    if (!this.paused) return Promise.resolve();
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

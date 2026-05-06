import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export interface Config {
  courseUrl: string;
  userDataDir: string;
  browser: {
    mode: "launch" | "connect";
    connectUrl: string;
  };
  nextButtonText: string;
  selectors: {
    next: string[];
    dismiss: string[];
    quizSubmit: string[];
    deny: string[];
  };
  video: {
    autoplay: boolean;
    playbackRate: number;
    muted: boolean;
  };
  limits: {
    stallTimeoutSec: number;
    maxClicks: number;
    minClickDelayMs: number;
    maxClickDelayMs: number;
    postClickWaitMs: number;
  };
  stopWhen: {
    urlContains: string;
    textContains: string;
  };
}

const DEFAULTS: Config = {
  courseUrl: "",
  userDataDir: "./.chrome-profile",
  browser: { mode: "launch", connectUrl: "http://127.0.0.1:9222" },
  nextButtonText:
    "^(next|continue|proceed|submit|finish|got it|i agree|acknowledge|begin|ok|okay)$",
  selectors: { next: [], dismiss: [], quizSubmit: [], deny: [] },
  video: { autoplay: true, playbackRate: 1.0, muted: true },
  limits: {
    stallTimeoutSec: 90,
    maxClicks: 500,
    minClickDelayMs: 400,
    maxClickDelayMs: 1200,
    postClickWaitMs: 1500,
  },
  stopWhen: { urlContains: "", textContains: "" },
};

export async function loadConfig(path = "./config.json"): Promise<Config> {
  const abs = resolve(process.cwd(), path);
  if (!existsSync(abs)) {
    throw new Error(
      `Config file not found at ${abs}. Copy config.example.json to config.json and edit it.`,
    );
  }
  const raw = await readFile(abs, "utf8");
  const parsed = JSON.parse(raw) as Partial<Config>;
  const merged: Config = {
    ...DEFAULTS,
    ...parsed,
    browser: { ...DEFAULTS.browser, ...(parsed.browser ?? {}) },
    selectors: { ...DEFAULTS.selectors, ...(parsed.selectors ?? {}) },
    video: { ...DEFAULTS.video, ...(parsed.video ?? {}) },
    limits: { ...DEFAULTS.limits, ...(parsed.limits ?? {}) },
    stopWhen: { ...DEFAULTS.stopWhen, ...(parsed.stopWhen ?? {}) },
  };
  if (!merged.courseUrl) {
    throw new Error("config.json is missing required field 'courseUrl'.");
  }
  return merged;
}

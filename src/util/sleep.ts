export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomBetween(min: number, max: number): number {
  if (max <= min) return min;
  return Math.floor(min + Math.random() * (max - min));
}

export async function humanDelay(minMs: number, maxMs: number): Promise<void> {
  await sleep(randomBetween(minMs, maxMs));
}

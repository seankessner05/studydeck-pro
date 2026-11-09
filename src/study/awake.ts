import { spawn, type ChildProcess } from "node:child_process";

type SpawnFn = (cmd: string, args: string[], opts: { stdio: "ignore" }) => Pick<ChildProcess, "kill" | "on">;

export interface AwakeOptions {
  platform?: string;
  spawnFn?: SpawnFn;
  /** Safety net: macOS lets go on its own after this many seconds even if we never release. */
  maxSeconds?: number;
}

/**
 * Stop a Mac from going to sleep while a long job runs (a sleeping Mac freezes every call in flight, which once
 * turned a 10-second job into a 9-minute one). Returns a function that releases it. Does nothing off macOS, and
 * never throws: staying awake is a nicety, not a requirement.
 */
export function keepAwake(opts: AwakeOptions = {}): () => void {
  if ((opts.platform ?? process.platform) !== "darwin") return () => {};
  try {
    const child = (opts.spawnFn ?? (spawn as unknown as SpawnFn))("caffeinate", ["-i", "-t", String(opts.maxSeconds ?? 1800)], { stdio: "ignore" });
    child.on("error", () => {});
    let released = false;
    return () => {
      if (released) return;
      released = true;
      try {
        child.kill();
      } catch {
        // already gone
      }
    };
  } catch {
    return () => {};
  }
}

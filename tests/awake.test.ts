import { describe, it, expect } from "vitest";
import { keepAwake } from "../src/study/awake";

function fakeSpawn() {
  const calls: { cmd: string; args: string[] }[] = [];
  let killed = 0;
  const spawnFn = (cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    return { kill: () => { killed++; return true; }, on: () => ({}) as any };
  };
  return { spawnFn: spawnFn as any, calls, killed: () => killed };
}

describe("keep the Mac awake during long jobs", () => {
  it("runs caffeinate on macOS with a safety timeout, and releases it exactly once", () => {
    const f = fakeSpawn();
    const release = keepAwake({ platform: "darwin", spawnFn: f.spawnFn, maxSeconds: 600 });
    expect(f.calls).toEqual([{ cmd: "caffeinate", args: ["-i", "-t", "600"] }]);
    release();
    release();
    expect(f.killed()).toBe(1);
  });

  it("does nothing on other platforms", () => {
    const f = fakeSpawn();
    keepAwake({ platform: "linux", spawnFn: f.spawnFn })();
    expect(f.calls).toEqual([]);
  });

  it("never throws, even if caffeinate can't be started", () => {
    const broken = () => { throw new Error("spawn caffeinate ENOENT"); };
    expect(() => keepAwake({ platform: "darwin", spawnFn: broken as any })()).not.toThrow();
  });
});

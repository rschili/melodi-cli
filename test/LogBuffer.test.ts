import { describe, it, expect } from "vitest";
import { LogBuffer } from "../src/LogBuffer";

describe("LogBuffer", () => {
  it("captures console.log output", () => {
    const buf = new LogBuffer();
    const originalLog = console.log;

    buf.start();
    console.log("captured message");
    console.log("another one");

    // console.log should be overridden
    expect(console.log).not.toBe(originalLog);

    buf.restorePrintAndClear();

    // Should restore original console.log
    expect(console.log).toBe(originalLog);
  });

  it("prints nothing when buffer is empty", () => {
    const buf = new LogBuffer();
    const originalLog = console.log;
    const calls: string[] = [];
    console.log = (...args: unknown[]) => calls.push(args.join(" "));

    buf.start();
    // Don't log anything
    buf.restorePrintAndClear();

    // restore
    console.log = originalLog;
    // No "Collected logs:" header should have been printed
    expect(calls.some((c) => c.includes("Collected logs:"))).toBe(false);
  });
});

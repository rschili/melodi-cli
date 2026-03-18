import { describe, it, expect, vi, afterEach } from "vitest";
import { printError, generateColorizerMap, timeSpanToString } from "../src/ConsoleHelper";

describe("ConsoleHelper", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("printError", () => {
    it("prints Error message to stderr", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      printError(new Error("something broke"));
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toContain("something broke");
    });

    it("prints non-Error values to stderr", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      printError("just a string");
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toContain("just a string");
    });

    it("prints as warning when flag is set", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      printError(new Error("soft issue"), true);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toContain("soft issue");
    });
  });

  describe("generateColorizerMap", () => {
    it("assigns unique colors to unique values", () => {
      const map = generateColorizerMap(["a", "b", "c"]);
      expect(map.size).toBe(3);
      expect(typeof map.get("a")).toBe("function");
    });

    it("deduplicates repeated values", () => {
      const map = generateColorizerMap(["x", "x", "y", "y", "y"]);
      expect(map.size).toBe(2);
    });

    it("returns empty map for empty input", () => {
      const map = generateColorizerMap([]);
      expect(map.size).toBe(0);
    });

    it("wraps around colors when more values than colors", () => {
      const values = Array.from({ length: 10 }, (_, i) => `v${i}`);
      const map = generateColorizerMap(values);
      expect(map.size).toBe(10);
      // All should be functions even though we wrapped around
      for (const fn of map.values()) {
        expect(typeof fn).toBe("function");
        expect(fn("test")).toBeTruthy();
      }
    });
  });

  describe("timeSpanToString", () => {
    it("returns undefined for zero", () => {
      expect(timeSpanToString(0)).toBeUndefined();
    });

    it("returns undefined for negative values", () => {
      expect(timeSpanToString(-1000)).toBeUndefined();
    });

    it("returns seconds for small spans", () => {
      expect(timeSpanToString(5000)).toBe("5 seconds");
      expect(timeSpanToString(1000)).toBe("1 second");
    });

    it("returns minutes", () => {
      expect(timeSpanToString(60_000)).toBe("1 minute");
      expect(timeSpanToString(120_000)).toBe("2 minutes");
    });

    it("returns hours", () => {
      expect(timeSpanToString(3_600_000)).toBe("1 hour");
      expect(timeSpanToString(7_200_000)).toBe("2 hours");
    });

    it("returns days", () => {
      expect(timeSpanToString(86_400_000)).toBe("1 day");
      expect(timeSpanToString(172_800_000)).toBe("2 days");
    });

    it("returns years for very large spans", () => {
      const oneYear = 365.25 * 86_400_000;
      expect(timeSpanToString(oneYear)).toBe("1 year");
      expect(timeSpanToString(oneYear * 3)).toBe("3 years");
    });

    it("returns undefined for extremely large values", () => {
      const hundredYears = 100 * 365.25 * 86_400_000;
      expect(timeSpanToString(hundredYears + 1)).toBeUndefined();
    });
  });
});

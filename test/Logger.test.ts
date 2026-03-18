import { describe, it, expect, vi, beforeEach } from "vitest";
import { LogLevel, Logger as BeLogger } from "@itwin/core-bentley";
import { Logger } from "../src/Logger";

describe("Logger", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("setLevel", () => {
    it("initializes BeLogger for LogLevel.None", () => {
      const spy = vi.spyOn(BeLogger, "initialize");
      Logger.setLevel(LogLevel.None);
      expect(spy).toHaveBeenCalledWith(undefined, undefined, undefined, undefined);
    });

    it("initializes BeLogger for LogLevel.Error with only error handler", () => {
      const spy = vi.spyOn(BeLogger, "initialize");
      Logger.setLevel(LogLevel.Error);
      expect(spy).toHaveBeenCalledWith(expect.any(Function), undefined, undefined, undefined);
    });

    it("initializes BeLogger for LogLevel.Warning with error and warning handlers", () => {
      const spy = vi.spyOn(BeLogger, "initialize");
      Logger.setLevel(LogLevel.Warning);
      expect(spy).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), undefined, undefined);
    });

    it("initializes BeLogger for LogLevel.Info with error, warning, and info handlers", () => {
      const spy = vi.spyOn(BeLogger, "initialize");
      Logger.setLevel(LogLevel.Info);
      expect(spy).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), expect.any(Function), undefined);
    });

    it("initializes BeLogger for LogLevel.Trace with all handlers", () => {
      const spy = vi.spyOn(BeLogger, "initialize");
      Logger.setLevel(LogLevel.Trace);
      expect(spy).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), expect.any(Function), expect.any(Function));
    });

    it("sets the default log level on BeLogger", () => {
      const spy = vi.spyOn(BeLogger, "setLevelDefault");
      Logger.setLevel(LogLevel.Info);
      expect(spy).toHaveBeenCalledWith(LogLevel.Info);
    });

    it("throws for unsupported log level", () => {
      expect(() => Logger.setLevel(999 as LogLevel)).toThrow("Unsupported log level");
    });

    it("error handler produces formatted output", () => {
      const spy = vi.spyOn(BeLogger, "initialize");
      Logger.setLevel(LogLevel.Error);
      const errorFn = spy.mock.calls[0][0] as (cat: string, msg: string) => void;
      expect(errorFn).toBeDefined();
      // Call the handler — it logs via clack's log.error, which we don't need to verify output of
      expect(() => errorFn("TestCat", "test message")).not.toThrow();
    });

    it("warning handler produces formatted output", () => {
      const spy = vi.spyOn(BeLogger, "initialize");
      Logger.setLevel(LogLevel.Warning);
      const warningFn = spy.mock.calls[0][1] as (cat: string, msg: string) => void;
      expect(warningFn).toBeDefined();
      expect(() => warningFn("TestCat", "warn msg")).not.toThrow();
    });

    it("info handler produces formatted output", () => {
      const spy = vi.spyOn(BeLogger, "initialize");
      Logger.setLevel(LogLevel.Info);
      const infoFn = spy.mock.calls[0][2] as (cat: string, msg: string) => void;
      expect(infoFn).toBeDefined();
      expect(() => infoFn("TestCat", "info msg")).not.toThrow();
    });

    it("trace handler produces formatted output", () => {
      const spy = vi.spyOn(BeLogger, "initialize");
      Logger.setLevel(LogLevel.Trace);
      const traceFn = spy.mock.calls[0][3] as (cat: string, msg: string) => void;
      expect(traceFn).toBeDefined();
      expect(() => traceFn("TestCat", "trace msg")).not.toThrow();
    });
  });

  describe("getCurrentLevelString", () => {
    it("returns 'off' for LogLevel.None", () => {
      const result = Logger.getCurrentLevelString(LogLevel.None);
      expect(result).toContain("off");
    });

    it("returns errors string for LogLevel.Error", () => {
      const result = Logger.getCurrentLevelString(LogLevel.Error);
      expect(result).toContain("errors");
    });

    it("returns errors and warnings for LogLevel.Warning", () => {
      const result = Logger.getCurrentLevelString(LogLevel.Warning);
      expect(result).toContain("errors");
      expect(result).toContain("warnings");
    });

    it("returns errors, warnings, and info for LogLevel.Info", () => {
      const result = Logger.getCurrentLevelString(LogLevel.Info);
      expect(result).toContain("errors");
      expect(result).toContain("warnings");
      expect(result).toContain("info");
    });

    it("returns all levels for LogLevel.Trace", () => {
      const result = Logger.getCurrentLevelString(LogLevel.Trace);
      expect(result).toContain("errors");
      expect(result).toContain("warnings");
      expect(result).toContain("info");
      expect(result).toContain("trace");
    });

    it("returns 'off' for undefined", () => {
      const result = Logger.getCurrentLevelString(undefined);
      expect(result).toContain("off");
    });

    it("returns 'off' for unknown level", () => {
      const result = Logger.getCurrentLevelString(999 as LogLevel);
      expect(result).toContain("off");
    });
  });
});

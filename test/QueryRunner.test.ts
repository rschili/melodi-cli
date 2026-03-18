import { describe, it, expect } from "vitest";
import { calculateColumnWidths } from "../src/Logic/QueryRunner";

describe("calculateColumnWidths", () => {
  it("returns empty for empty data", () => {
    expect(calculateColumnWidths([], 120)).toEqual([]);
  });

  it("sizes columns based on content width", () => {
    const data = [
      ["Name", "Age"],
      ["Alice", "30"],
      ["Bob", "7"],
    ];
    const widths = calculateColumnWidths(data, 120);
    expect(widths).toHaveLength(2);
    expect(widths[0]).toBeGreaterThanOrEqual(5); // "Alice"
    expect(widths[1]).toBeGreaterThanOrEqual(3); // "Age"
  });

  it("shrinks widest column when total exceeds maxWidth", () => {
    // 5 + 67 = 72 content + 2*3 = 78 total, fits in 80, so no shrink.
    // Use a tighter table to force shrinking:
    const data = [
      ["ShortCol", "AnotherCol", "A very very very long column value that exceeds anything"],
    ];
    const widths = calculateColumnWidths(data, 80); // floors to 80
    // Total must fit: sum(widths) + cols*3 <= 80
    const total = widths.reduce((s, w) => s + w, 0) + widths.length * 3;
    expect(total).toBeLessThanOrEqual(80);
    // The widest column should have been shrunk
    expect(widths[2]).toBeLessThan(54);
  });

  it("applies minimum width per column when many columns exceed max", () => {
    // Need >10 columns so that 80 < numCols * 8
    const cols = Array.from({ length: 11 }, (_, i) => `C${i}`);
    const data = [cols];
    // 11 * 8 = 88 > 80 (floored maxWidth), so the min branch kicks in
    const widths = calculateColumnWidths(data, 10);
    expect(widths).toHaveLength(11);
    for (const w of widths) {
      expect(w).toBe(8);
    }
  });

  it("handles multiline cells", () => {
    const data = [
      ["Header"],
      ["line1\na-much-longer-line2"],
    ];
    const widths = calculateColumnWidths(data, 120);
    expect(widths[0]).toBeGreaterThanOrEqual(19); // "a-much-longer-line2"
  });
});

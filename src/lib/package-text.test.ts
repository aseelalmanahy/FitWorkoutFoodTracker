// Phase 4: only words that could name a product become search choices; numbers, nutrition and claims never do.
import { describe, expect, it } from "vitest";
import { MAX_PACKAGE_LINES, packageTextLines } from "./package-text";

describe("package words", () => {
  it("keeps names and brands, drops numbers, nutrition terms and marketing claims", () => {
    const ocr = "HILLSIDE\nGreek Yogurt\n2% Fat\nHigh in Protein\nNatural\n170 g\nEnergy 73 kcal per 100g\nIngredients: milk, cultures\n|||| ~~ ;;\nGreek Yogurt\nBest before 12/27";
    expect(packageTextLines(ocr)).toEqual(["HILLSIDE", "Greek Yogurt"]);
  });
  it("is bounded and cleans stray symbols", () => {
    expect(packageTextLines(Array.from({ length: 30 }, (_, i) => `Brand Line ${String.fromCharCode(65 + (i % 26))}${i}`).join("\n"))).toHaveLength(MAX_PACKAGE_LINES);
    expect(packageTextLines("Cola*** Zero!!")).toEqual(["Cola Zero"]);
    expect(packageTextLines("")).toEqual([]);
  });
});

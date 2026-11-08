// Phase 2: real product codes, as printed on packages, and the misreads a camera can produce.
import { describe, expect, it } from "vitest";
import { createStableReader, gtinCheckDigitValid, productCode, upcEToUpcA } from "./barcode";

describe("product codes", () => {
  it("accepts real EAN-13, EAN-8, UPC-A and GTIN-14 codes", () => {
    for (const code of ["3017620425035" /* Nutella, EAN-13 */, "5000159407236" /* EAN-13 */, "96385074" /* EAN-8 */, "036000291452" /* UPC-A */, "012345678905" /* UPC-A */, "10012345678902" /* GTIN-14 */]) {
      expect(productCode(code), code).toBe(code);
    }
  });
  it("refuses a wrong check digit, other lengths and anything not digits", () => {
    for (const bad of ["3017620425036", "036000291453", "12345", "1234567890", "30176204250350000", "ABCDEFGHIJKLM", "https://example.com/3017620425035", ""]) {
      expect(productCode(bad), bad).toBeNull();
    }
  });
  it("ignores the spaces and dashes a person types", () => {
    expect(productCode("3 017620 425035")).toBe("3017620425035");
    expect(productCode("0360-0029-1452")).toBe("036000291452");
  });
  it("expands UPC-E to the UPC-A databases use, in each of its forms", () => {
    expect(upcEToUpcA("04252614")).toBe("042100005264");
    expect(upcEToUpcA("01234565")).toBe("012345000065");
    expect(productCode("04252614", "upc_e")).toBe("042100005264");
    expect(productCode("04252614")).toBe("042100005264"); // not a valid EAN-8, so tried as UPC-E
    expect(upcEToUpcA("24252614")).toBeNull(); // number system 2 isn't UPC-E
    expect(upcEToUpcA("04252615")).toBeNull(); // wrong check digit
  });
  it("the check digit rule itself", () => {
    expect(gtinCheckDigitValid("4006381333931")).toBe(true);
    expect(gtinCheckDigitValid("4006381333932")).toBe(false);
  });
});

describe("camera frames", () => {
  it("a code counts only after two identical valid reads in a row", () => {
    const read = createStableReader();
    expect(read("3017620425035")).toBeNull();
    expect(read("3017620425035")).toBe("3017620425035");
  });
  it("a misread frame in between, or nothing read, starts over", () => {
    const read = createStableReader();
    expect(read("3017620425035")).toBeNull();
    expect(read("3017620425036")).toBeNull(); // wrong check digit
    expect(read("3017620425035")).toBeNull();
    expect(read(null)).toBeNull();
    expect(read("3017620425035")).toBeNull();
    expect(read("3017620425035")).toBe("3017620425035");
  });
  it("two different valid codes alternating never settle", () => {
    const read = createStableReader();
    for (let i = 0; i < 6; i++) expect(read(i % 2 ? "96385074" : "3017620425035")).toBeNull();
  });
});

/**
 * Phase 2: which product barcodes the scanner accepts. Retail codes only (EAN-13, EAN-8, UPC-A, UPC-E, GTIN-14),
 * each with a correct check digit, so a misread is refused before anything is looked up. Pure, shared by the camera,
 * a still photo, typed entry and the tests. Frames are never sent anywhere: only the digits are.
 */

/** The formats asked of a detector: product codes only, never QR or other symbols that could carry a link. */
export const PRODUCT_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"] as const;

/** GS1 mod-10: weights 3 and 1 from the right, excluding the check digit itself. */
export function gtinCheckDigitValid(code: string): boolean {
  if (!/^\d+$/.test(code)) return false;
  const digits = code.split("").map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/** UPC-E (8 digits, number system 0 or 1) to the UPC-A it stands for, which is how databases store it. */
export function upcEToUpcA(upce: string): string | null {
  if (!/^[01]\d{7}$/.test(upce)) return null;
  const [ns, d1, d2, d3, d4, d5, d6, check] = upce.split("");
  let body: string;
  if (d6 === "0" || d6 === "1" || d6 === "2") body = `${d1}${d2}${d6}0000${d3}${d4}${d5}`;
  else if (d6 === "3") body = `${d1}${d2}${d3}00000${d4}${d5}`;
  else if (d6 === "4") body = `${d1}${d2}${d3}${d4}00000${d5}`;
  else body = `${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  const upca = `${ns}${body}${check}`;
  return gtinCheckDigitValid(upca) ? upca : null;
}

/**
 * A code as a detector or a person gives it, as the digits to look up, or null if it isn't a valid product code.
 * Spaces and dashes typed by a person are ignored. An 8-digit code is tried as EAN-8 first, then as UPC-E.
 */
export function productCode(raw: string, format?: string): string | null {
  const code = raw.replace(/[\s-]/g, "");
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return null;
  if (format === "upc_e" || (code.length === 8 && !gtinCheckDigitValid(code))) return upcEToUpcA(code);
  return gtinCheckDigitValid(code) ? code : null;
}

/**
 * Camera frames: a code is accepted once the same valid value is read in two frames in a row, so a single blurred,
 * misread frame can't pick a product. Returns the accepted code, or null to keep looking.
 */
export function createStableReader(needed = 2) {
  let last: string | null = null;
  let streak = 0;
  return (raw: string | null, format?: string): string | null => {
    const code = raw === null ? null : productCode(raw, format);
    if (code === null) { last = null; streak = 0; return null; }
    streak = code === last ? streak + 1 : 1;
    last = code;
    return streak >= needed ? code : null;
  };
}

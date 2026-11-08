/**
 * Where a label or meal photo is read, and how the page says so (RC-07). Only the kind is ever named: no product,
 * model, version or address reaches the page.
 *  - "server": read by this app's own server (on-device OCR or the meal model). The image goes nowhere else.
 *  - "provider": sent to the external AI provider the server is configured with.
 *  - "pdf-text": values taken from a PDF's own text, in the person's browser, with no recognition at all.
 * The page is never told the image is read on the phone: photos are always read on the server.
 */
export type ImageProcessing = "server" | "provider";
export type LabelSource = ImageProcessing | "pdf-text";

/** What the server's reader id says about where the work happened. Local readers' ids start with "local:". */
export const processingOf = (readerId: string): ImageProcessing => (readerId.startsWith("local:") ? "server" : "provider");

export const LABEL_COPY: Record<ImageProcessing, { beforeScan: string; pdfSection: string; rescan: string }> = {
  server: {
    beforeScan: "Scanning reads this image with text recognition on this app's server, after removing location and other hidden data. It isn't sent to any other company, and it isn't kept.",
    pdfSection: "Reading from the text uses no recognition. Scanning reads only the part of this page you choose, with text recognition on this app's server, and counts as a scan.",
    rescan: "Scanning again reads the image again on this app's server, counts as a scan, and discards your corrections.",
  },
  provider: {
    beforeScan: "Scanning sends this image to our AI provider, after removing location and other hidden data. Your name and email aren't sent.",
    pdfSection: "Reading from the text uses no AI. Scanning sends only the part of this page you choose to our AI provider, and counts as a scan.",
    rescan: "Scanning sends the image to the AI provider, counts as a scan, and discards your corrections.",
  },
};

export const MEAL_COPY: Record<ImageProcessing, { beforeIdentify: string }> = {
  server: { beforeIdentify: "Identifying reads this photo with a recognition model on this app's server, after removing location and other hidden data. It isn't sent to any other company, and it isn't kept." },
  provider: { beforeIdentify: "Identifying sends this photo to our AI provider, after removing location and other hidden data. Your name and email aren't sent, and the photo isn't kept." },
};

/** The label on a value the reader filled in, by where it came from. Corrections and the rest keep their own labels. */
export const READ_LABEL: Record<LabelSource, string> = {
  provider: "Read by AI",
  server: "Read by text recognition",
  "pdf-text": "Read from the PDF",
};

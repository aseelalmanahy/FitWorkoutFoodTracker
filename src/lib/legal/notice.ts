import { sha256Hex } from "./sha256";

/**
 * The privacy notice and terms, from one versioned source. /privacy and /terms render this.
 *
 * **This is a draft. It states what the software does, and isn't legal advice or an approved document.** Marked gaps
 * are facts that haven't been decided, or questions for a legal or clinical reviewer. A draft can't open registration
 * on a real deployment, and a tick against it isn't a claim of valid consent.
 *
 * Status comes only from this committed source, and never from the environment. See noticeIsFinal.
 */
export interface NoticeSection { heading: string; paragraphs: string[] }
export interface NoticeReview { date: string; reviewer: string; textSha256: string }
export interface Notice {
  version: string;
  status: "draft" | "final";
  /** Filled in when reviewed advice exists. The hash covers the text, so a later edit undoes the approval. */
  review: NoticeReview | null;
  privacy: NoticeSection[];
  terms: NoticeSection[];
  /** Ids in data-inventory.json. A test keeps the text, these lists and the inventory in step. */
  names: { processors: string[]; periods: string[] };
}

/** Marks a fact not yet decided, or a question for a reviewer. A final notice can't contain one. */
export const DRAFT_MARKER = "[TO CONFIRM";
const gap = (what: string) => `${DRAFT_MARKER}: ${what}]`;

export const NOTICE: Notice = {
  version: "draft-2026-11-06b",
  status: "draft",
  review: null,
  names: {
    processors: ["usda", "open-food-facts", "anthropic", "host", "database", "email-provider"],
    periods: ["session", "device-cookie", "signup-link", "reset-link", "backups", "logs", "unused-accounts"],
  },
  privacy: [
    { heading: "Who is responsible", paragraphs: [`This app is run by ${gap("the operator and country, Decisions 2 and 3")}. Contact: ${gap("support contact, Decision 16")}.`] },
    {
      heading: "What is stored",
      paragraphs: [
        "Your email address, a hash of your password (never the password itself), and your sign-in sessions. Links we email you are stored only as a hash, with the address they were sent to.",
        "Your name and date of birth, your units and time zone, and any other details you choose to add to your profile: sex, height, weight, goal weight, goal, activity level, experience and training days. Those others are optional.",
        "What you log: your dated body-weight entries, custom exercises, plans, your schedule, workouts, sets, repetitions, weights, effort ratings and notes, custom foods, your food diary and any nutrition targets.",
        "Which version of this notice was current when your account was created, and when that was.",
        "Your browser keeps a sign-in cookie, and a cookie that remembers this device for 90 days, so that someone else's failed logins can't lock you out. Neither holds your password.",
        gap("whether birth date, weight and food count as health data, and what follows from that"),
      ],
    },
    {
      heading: "Why",
      paragraphs: [
        `To run your account and show you your own records. The app holds no advertising or analytics code. ${gap("any commitment about selling or sharing data")}`,
        "Your date of birth is used to check you declare yourself to be an adult. It isn't verified.",
        gap("the legal basis for each use"),
      ],
    },
    {
      heading: "Who else receives data",
      paragraphs: [
        "When you search for a food, scan a barcode or open a food's details, the search text, barcode or food id goes to USDA FoodData Central or Open Food Facts. Your name and account details don't.",
        "Label and meal photos go to Anthropic to be read, but only when the settings for that feature are present. A real deployment refuses to start with those settings today.",
        `The hosting provider and database provider hold what's described above, and the email provider receives your address and the links we send you. ${gap("each provider's name, location and agreement, Decision 5")}`,
      ],
    },
    {
      heading: "How long",
      paragraphs: [
        "A sign-in session lasts 30 days. A sign-up link works for 24 hours, and a password reset link for 60 minutes.",
        "Nothing removes expired rows on a schedule yet. An expired session stays until you change or reset your password, or delete your account. An expired link, with the address it was sent to, stays until the app next issues a new link to anyone.",
        `Backups: ${gap("backup period, Decision 12")}. Logs: ${gap("log period, Decision 5")}. Accounts that were never finished, or can't be used: ${gap("retention rule, R-06")}.`,
      ],
    },
    {
      heading: "Your choices",
      paragraphs: [
        "You can download your data and delete your account yourself, from your account page. Deleting removes your account and what you've logged straight away. Shared exercise and food information stays.",
        `A backup can keep a copy until it expires, and restoring one could bring a deleted account back. ${gap("how this is handled, S-14")}`,
        gap("rights and timing that apply in the chosen country, and how to complain"),
      ],
    },
    { heading: "Changes", paragraphs: [`This notice has a version. ${gap("whether a change needs accepting again, O3")}`] },
  ],
  terms: [
    { heading: "Who this is for", paragraphs: ["This app is for adults 18 and over, by invitation. Your age is what you declare, and it isn't verified.", gap("minimum age for the chosen country, and wording on declared age")] },
    { heading: "Not medical advice", paragraphs: [`This app records what you enter. It doesn't give medical or nutrition advice, and can't account for health conditions, pregnancy or medication. ${gap("final wording, and who this isn't for, Decision 7")}`] },
    { heading: "Accuracy", paragraphs: ["Food information can come from outside sources, and may be wrong. A value a source doesn't give stays empty on that entry. Daily totals add up only what's known, so they can be lower than what you really ate."] },
    { heading: "Your account", paragraphs: ["Keep your password to yourself. You can delete your account at any time.", gap("what happens at the end of the beta, Decision 16")] },
    { heading: "Legal", paragraphs: [gap("operator, governing law, liability and how these terms change")] },
  ],
};

const isRealDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;

/** What's reviewed, in a stable form, so that a hash of it means this exact text. */
export const noticeText = (notice: Notice) => JSON.stringify({ version: notice.version, privacy: notice.privacy, terms: notice.terms });
export const noticeHash = (notice: Notice) => sha256Hex(noticeText(notice));

/**
 * The only test of status. A typed word can't pass it: it needs the exact status, a non-draft version, a recorded
 * review with a real date, no marker left, and a hash matching the text. Anything else counts as a draft.
 *
 * The hash proves the text hasn't changed since the record was written, and proves nothing about a review having
 * happened. That's for whoever reviews the commit that sets it, which is why it can only change through a commit.
 */
export function noticeIsFinal(notice: Notice = NOTICE): boolean {
  if (notice.status !== "final" || /^\s*draft/i.test(notice.version) || !notice.review) return false;
  const { date, reviewer, textSha256 } = notice.review;
  if (!isRealDate(date) || !reviewer.trim()) return false;
  if (noticeText(notice).includes(DRAFT_MARKER)) return false;
  return textSha256 === noticeHash(notice);
}

/** Says "final", but doesn't pass. That's a mistake, as opposed to a draft that knows it's one. */
export const noticeIsMalformed = (notice: Notice = NOTICE) => notice.status === "final" && !noticeIsFinal(notice);

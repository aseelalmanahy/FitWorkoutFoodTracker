import { describe, expect, it } from "vitest";
import { feedbackSubmitSchema, feedbackUpdateSchema, redactFeedbackText } from "./feedback";
import { adminUserIds, isAdmin } from "./server/admins";

const ok = { category: "BUG", description: "The chart is blank" };

describe("what a person may send", () => {
  it("a category, 10 to 2,000 characters after trimming, and optionally an app page path", () => {
    expect(feedbackSubmitSchema.parse({ ...ok, route: "/workouts/plans" }).route).toBe("/workouts/plans");
    expect(feedbackSubmitSchema.parse({ ...ok, description: "  The chart is blank  " }).description).toBe("The chart is blank");
    for (const bad of [{ ...ok, category: "OTHER" }, { ...ok, description: " short  " }, { ...ok, description: "x".repeat(2001) }, { ...ok, route: "/a?b=c" }, { ...ok, route: "https://x" }, { ...ok, extra: 1 }]) {
      expect(feedbackSubmitSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("what an administrator may change", () => {
  it("only the review fields, with an https task link, and something to change", () => {
    expect(feedbackUpdateSchema.safeParse({ status: "DONE", taskLink: "https://github.com/x/y/issues/1" }).success).toBe(true);
    for (const bad of [{}, { description: "x" }, { taskLink: "javascript:alert(1)" }, { taskLink: "http://x.example" }, { duplicateOfId: "../x" }, { status: "WONTFIX" }]) {
      expect(feedbackUpdateSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("redaction for the review export", () => {
  it("replaces addresses, links, handles and long numbers, and keeps the rest", () => {
    expect(redactFeedbackText("Mail jo.bloggs+fit@mail.example.com or see https://x.example/a?t=1, www.y.example, @jo_b, +44 (0)7700 900-123, order 12345678"))
      .toBe("Mail [email] or see [link] [link] [handle], [number], order [number]");
    expect(redactFeedbackText("3 sets of 10 reps at 60 kg")).toBe("3 sets of 10 reps at 60 kg");
  });
});

describe("administrators", () => {
  it("are exactly the well-formed IDs in ADMIN_USER_IDS; anything else is ignored, and none by default", () => {
    const id = "c" + "a1".repeat(12);
    expect([...adminUserIds({ ADMIN_USER_IDS: ` ${id} , not-an-id, ,*,${id}` })]).toEqual([id]);
    expect(isAdmin(id, { ADMIN_USER_IDS: id })).toBe(true);
    expect(isAdmin(id, {})).toBe(false);
    expect(isAdmin("*", { ADMIN_USER_IDS: "*" })).toBe(false);
    expect(isAdmin(id.toUpperCase(), { ADMIN_USER_IDS: id.toUpperCase() })).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { acceptItem, addItem, buildMealReview, canFindFood, describeSuggestion, isCorrected, markLogged, markUnknown, removeItem, renameItem, searchQueryFor, type ReviewItem } from "./meal-review";
import type { MealIdentification } from "./meal-identification";

const ident: MealIdentification = {
  containsFood: true,
  items: [
    { name: "grilled steak", category: "meat", certainty: "likely", observation: "Dark seared meat", possibleIngredients: [], preparation: "grilled" },
    { name: "green vegetable, possibly broccoli", category: "vegetable", certainty: "possible", observation: "Green florets", possibleIngredients: ["broccoli"], preparation: null },
    { name: null, category: "unknown", certainty: "unknown", observation: "A dark shape", possibleIngredients: [], preparation: null },
  ],
};
const start = () => buildMealReview(ident);
const find = (items: ReviewItem[], id: string) => items.find((i) => i.id === id)!;
const [steak, broccoli, mystery] = ["suggested-0", "suggested-1", "suggested-2"];

describe("starting from suggestions", () => {
  it("makes one separate item for each food, none of them reviewed", () => {
    const items = start();
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.status === "suggested")).toBe(true);
  });

  it("an unidentified food starts with an empty name", () => {
    expect(find(start(), mystery).name).toBe("");
  });

  it("holds no amount of any kind, so none can be carried forward", () => {
    const allowed = ["category", "certainty", "id", "name", "observation", "possibleIngredients", "preparation", "status", "suggestedName"];
    for (const item of start()) expect(Object.keys(item).sort()).toEqual(allowed);
    for (const item of addItem([])) expect(Object.keys(item).sort()).toEqual(allowed);
  });

  it("says what the AI suggested, in words that don't read as fact", () => {
    const items = start();
    expect(describeSuggestion(items[0])).toBe("Likely grilled steak.");
    expect(describeSuggestion(items[1])).toBe("Possibly green vegetable, possibly broccoli.");
    expect(describeSuggestion(items[2])).toBe("This food couldn't be identified.");
    expect(describeSuggestion(addItem([])[0])).toBe("Added by you.");
  });
});

describe("a suggestion is never used until accepted", () => {
  it("can't be searched for before it's accepted", () => {
    const item = find(start(), steak);
    expect(canFindFood(item)).toBe(false);
    expect(searchQueryFor(item)).toBeNull();
  });

  it("an accepted name becomes the query, and nothing else does", () => {
    const item = find(acceptItem(start(), steak), steak);
    expect(item.status).toBe("accepted");
    expect(searchQueryFor(item)).toBe("grilled steak");
  });

  it("an empty name can't be accepted", () => {
    expect(find(acceptItem(start(), mystery), mystery).status).toBe("suggested");
    expect(find(acceptItem(renameItem(start(), steak, "   "), steak), steak).status).toBe("suggested");
  });

  it("a name too short to search can't be searched for", () => {
    const item = find(acceptItem(renameItem(start(), steak, "x"), steak), steak);
    expect(canFindFood(item)).toBe(false);
    expect(searchQueryFor(item)).toBeNull();
  });

  it("the query uses the person's words, not the AI's", () => {
    const item = find(acceptItem(renameItem(start(), broccoli, "  green beans "), broccoli), broccoli);
    expect(searchQueryFor(item)).toBe("green beans");
  });
});

describe("correcting", () => {
  it("changing a name needs accepting again", () => {
    const accepted = acceptItem(start(), steak);
    const renamed = renameItem(accepted, steak, "pork chop");
    expect(find(renamed, steak).status).toBe("suggested");
    expect(searchQueryFor(find(renamed, steak))).toBeNull();
  });

  it("records that a name was corrected, and keeps what was suggested", () => {
    const item = find(renameItem(start(), steak, "pork chop"), steak);
    expect(isCorrected(item)).toBe(true);
    expect(item.suggestedName).toBe("grilled steak");
    expect(isCorrected(find(start(), steak))).toBe(false);
  });

  it("a name supplied for an unidentified food isn't a correction", () => {
    expect(isCorrected(find(renameItem(start(), mystery, "lentils"), mystery))).toBe(false);
  });
});

describe("removing, adding and marking unknown", () => {
  it("removes only the chosen item", () => {
    expect(removeItem(start(), steak).map((i) => i.id)).toEqual([broccoli, mystery]);
  });

  it("adds a food the AI missed, empty, with nothing from the AI", () => {
    const items = addItem(start());
    const added = items[items.length - 1];
    expect(items).toHaveLength(4);
    expect(added).toMatchObject({ name: "", suggestedName: "", status: "suggested", certainty: null, observation: null, possibleIngredients: [] });
  });

  it("two added foods stay separate", () => {
    const items = addItem(addItem([]));
    expect(new Set(items.map((i) => i.id)).size).toBe(2);
  });

  it("marking unknown clears the name and can't be searched for", () => {
    const item = find(markUnknown(acceptItem(start(), steak), steak), steak);
    expect(item).toMatchObject({ name: "", status: "unknown" });
    expect(searchQueryFor(item)).toBeNull();
  });

  it("an unknown item can be named later, and accepted", () => {
    const named = renameItem(markUnknown(start(), steak), steak, "beef");
    expect(find(acceptItem(named, steak), steak).status).toBe("accepted");
  });
});

describe("logging", () => {
  const logged = () => markLogged(acceptItem(start(), steak), steak);

  it("only an accepted item can be marked logged", () => {
    expect(find(markLogged(start(), steak), steak).status).toBe("suggested");
    expect(find(logged(), steak).status).toBe("logged");
  });

  it("a logged item can't be changed, removed, or searched for again", () => {
    expect(find(renameItem(logged(), steak, "x"), steak).name).toBe("grilled steak");
    expect(find(markUnknown(logged(), steak), steak).status).toBe("logged");
    expect(find(removeItem(logged(), steak), steak)).toBeDefined();
    expect(searchQueryFor(find(logged(), steak))).toBeNull();
  });

  it("logging one food leaves the others alone", () => {
    expect(find(logged(), broccoli).status).toBe("suggested");
  });
});

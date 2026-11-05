/**
 * The rules for reviewing meal-photo suggestions. Pure functions. A suggestion is only a name to
 * consider: a person accepts or changes it, chooses a real food record, then types a quantity, in the
 * existing food workflow. These items hold no amount of any kind, so none can be carried forward.
 */
import type { MealIdentification, MealItem } from "./meal-identification";

export type ReviewStatus =
  /** As the AI suggested it, not yet reviewed. */
  | "suggested"
  /** The person confirmed this identity, as suggested or after changing the name. */
  | "accepted"
  /** The person marked this as not identifiable. */
  | "unknown"
  /** It's been logged, through the normal food workflow. */
  | "logged";

export interface ReviewItem {
  id: string;
  /** What the person will search for, once they've accepted it. */
  name: string;
  /** What the AI suggested. Empty for a food the person added. */
  suggestedName: string;
  status: ReviewStatus;
  /** The AI's own words, shown as context. Empty for a food the person added. */
  certainty: MealItem["certainty"] | null;
  category: MealItem["category"] | null;
  observation: string | null;
  possibleIngredients: string[];
  preparation: string | null;
}

export function buildMealReview(identification: MealIdentification): ReviewItem[] {
  return identification.items.map((item, i) => ({
    id: `suggested-${i}`,
    name: item.name ?? "",
    suggestedName: item.name ?? "",
    status: "suggested",
    certainty: item.certainty,
    category: item.category,
    observation: item.observation,
    possibleIngredients: item.possibleIngredients,
    preparation: item.preparation,
  }));
}

const update = (items: ReviewItem[], id: string, change: (item: ReviewItem) => ReviewItem) => items.map((item) => (item.id === id ? change(item) : item));

/** Changing a name needs accepting again, as the person agreed to the name they saw. */
export const renameItem = (items: ReviewItem[], id: string, name: string) => update(items, id, (item) => (item.status === "logged" ? item : { ...item, name, status: "suggested" }));
export const acceptItem = (items: ReviewItem[], id: string) => update(items, id, (item) => (item.name.trim() === "" || item.status === "logged" ? item : { ...item, name: item.name.trim(), status: "accepted" }));
export const markUnknown = (items: ReviewItem[], id: string) => update(items, id, (item) => (item.status === "logged" ? item : { ...item, name: "", status: "unknown" }));
/** Only called once the server has saved an entry, so it's true whatever happened to the item meanwhile. Anything else could invite logging it twice. */
export const markLogged = (items: ReviewItem[], id: string) => update(items, id, (item) => ({ ...item, status: "logged" }));
export const removeItem = (items: ReviewItem[], id: string) => items.filter((item) => item.id !== id || item.status === "logged");

let added = 0;
/** A food the AI missed. It's the person's own, so it starts empty, with nothing from the AI. */
export function addItem(items: ReviewItem[]): ReviewItem[] {
  added += 1;
  return [...items, { id: `added-${added}`, name: "", suggestedName: "", status: "suggested", certainty: null, category: null, observation: null, possibleIngredients: [], preparation: null }];
}

export const canFindFood = (item: ReviewItem) => item.status === "accepted" && item.name.trim().length >= 2;

/** The search text. Only a name the person accepted can ever become a query. */
export const searchQueryFor = (item: ReviewItem): string | null => (canFindFood(item) ? item.name.trim() : null);

export const isCorrected = (item: Pick<ReviewItem, "name" | "suggestedName">) => item.suggestedName !== "" && item.name.trim() !== item.suggestedName;

/** The AI's suggestion in plain words, which never reads as a fact. */
export function describeSuggestion(item: Pick<ReviewItem, "certainty" | "suggestedName">): string {
  if (item.certainty === "likely") return `Likely ${item.suggestedName}.`;
  if (item.certainty === "possible") return `Possibly ${item.suggestedName}.`;
  if (item.certainty === "unknown") return "This food couldn't be identified.";
  return "Added by you.";
}

/** Who decided what this food is. A person's confirmation says nothing about its nutrition. */
export function describeIdentity(item: Pick<ReviewItem, "name" | "suggestedName">): string {
  if (item.suggestedName === "") return "You added this food yourself.";
  return isCorrected(item) ? `You changed the AI's suggestion, ${item.suggestedName}, to ${item.name.trim()}.` : `You accepted the AI's suggestion, ${item.suggestedName}.`;
}

export const STATUS_LABELS: Record<ReviewStatus, string> = {
  suggested: "Not reviewed",
  accepted: "Accepted by you",
  unknown: "Marked unknown",
  logged: "Logged",
};

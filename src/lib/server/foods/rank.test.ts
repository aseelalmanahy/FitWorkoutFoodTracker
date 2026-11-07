// Relevance order, with record names exactly as USDA FoodData Central and Open Food Facts returned them on
// 2026-11-07 (captured from the live review environment). Values are irrelevant to the order except completeness.
import { describe, expect, it } from "vitest";
import { foodWords, rankFoods, relevance, singular } from "./rank";
import type { Nutrients } from "@/lib/nutrition";

const full: Nutrients = { kcal: 100, protein: 1, carbs: 1, fat: 1, fiber: null };
const none: Nutrients = { kcal: null, protein: null, carbs: null, fat: null, fiber: null };
const f = (name: string, per100 = full) => ({ name, per100 });
const order = (q: string, names: (string | [string, typeof full])[]) =>
  rankFoods(q, names.map((n) => (typeof n === "string" ? f(n) : f(n[0], n[1])))).map((x) => x.name);

describe("words", () => {
  it.each([["eggs", "egg"], ["bananas", "banana"], ["potatoes", "potato"], ["berries", "berry"], ["peaches", "peach"], ["oats", "oat"], ["milk", "milk"], ["glass", "glass"], ["rice", "rice"]])("%s → %s", (w, s) => expect(singular(w)).toBe(s));
  it("lowercases, drops punctuation and filler words, keeps percentages", () => {
    expect(foodWords("Milk, whole, 3.25% milkfat, with added vitamin D")).toEqual(["milk", "whole", "3.25%", "milkfat", "added", "vitamin", "d"]);
    expect(foodWords("Bananas, dehydrated, or banana powder")).toEqual(["banana", "dehydrated", "banana", "powder"]);
  });
});

describe("common foods come first", () => {
  it("milk: milk itself before coconut milk and milk crackers", () => {
    const r = order("milk", ["Coconut milk", "Crackers, milk", "Crackers, milk", "Milk, whole, 3.25% milkfat, with added vitamin D", "Milk, reduced fat, fluid, 2% milkfat"]);
    expect(r.slice(0, 2)).toEqual(["Milk, reduced fat, fluid, 2% milkfat", "Milk, whole, 3.25% milkfat, with added vitamin D"]);
    expect(r.at(-1)).toBe("Crackers, milk");
  });
  it("banana: a raw banana before banana powder and baked banana", () => {
    const r = order("banana", ["Bananas, dehydrated, or banana powder", "Banana, baked", "Banana, raw", "Bananas, raw"]);
    expect(r.slice(0, 2)).toEqual(["Banana, raw", "Bananas, raw"]);
    expect(r.at(-1)).toBe("Bananas, dehydrated, or banana powder");
  });
  it("white rice: rice itself before puffed rice, and both before beans and rice", () => {
    const r = order("white rice", ["Beans and white rice", "Rice, white, puffed", "Rice, white, cooked, glutinous", "Rice, white, long-grain, regular, enriched, cooked"]);
    expect(r[0]).toBe("Rice, white, cooked, glutinous");
    expect(r.indexOf("Rice, white, puffed")).toBeGreaterThan(r.indexOf("Rice, white, long-grain, regular, enriched, cooked"));
    expect(r.at(-1)).toBe("Beans and white rice");
  });
  it("chicken breast: chicken breast before lunchmeat", () => {
    const r = order("chicken breast", ["Lunchmeat, chicken breast, sliced", "Chicken breast, rotisserie, skin not eaten", "Chicken breast tenders, breaded, uncooked"]);
    expect(r[0]).toBe("Chicken breast, rotisserie, skin not eaten");
    expect(r.at(-1)).toBe("Lunchmeat, chicken breast, sliced");
  });
  it("oatmeal: oatmeal before oatmeal bread", () => {
    expect(order("oatmeal", ["Bread, oatmeal", "Oatmeal, multigrain", "Oatmeal, NFS"])[2]).toBe("Bread, oatmeal");
  });
  it("eggs and large egg match egg records, singular or plural", () => {
    expect(order("eggs", ["Bread, egg", "Eggs, Grade A, Large, egg whole"])[0]).toBe("Eggs, Grade A, Large, egg whole");
    expect(relevance("large egg", f("Eggs, Grade A, Large, egg whole"))).toBeGreaterThan(relevance("large egg", f("Bread, egg")));
  });
  it("an exact name wins outright", () => {
    expect(order("greek yogurt", ["Yogurt, Greek, with oats", "Greek Yogurt", "Yogurt, Greek, plain, lowfat"])[0]).toBe("Greek Yogurt");
  });
});

describe("it only reorders", () => {
  it("returns the same records, untouched, and keeps the provider's order on ties", () => {
    const input = [f("Milk, lowfat"), f("Milk, nonfat"), f("Milk, skim")];
    const out = rankFoods("milk", input);
    expect(out).toEqual(input); // a tie: no variety is preferred for the person
    expect(out[0]).toBe(input[0]); // the same objects, not copies
    expect(new Set(rankFoods("milk", [f("a milk"), f("b")])).size).toBe(2);
  });
  it("a record with no nutrition goes after an otherwise equal one with it", () => {
    expect(order("banana", [["Banana", none], "Banana"]).length).toBe(2);
    const r = rankFoods("banana", [f("Banana", none), f("Banana")]);
    expect(r[0].per100.kcal).toBe(100);
  });
  it("an empty query changes nothing", () => {
    const input = [f("b"), f("a")];
    expect(rankFoods("  ", input)).toEqual(input);
  });
});

// RC-01: rules measured on the recorded benchmark (benchmark/), each with the case where the person asks for it.
describe("the generic food before a different food made from it", () => {
  it("word order: 'Rice, white' counts as fully as 'White rice', and rice flour goes after rice", () => {
    expect(order("white rice", ["White rice, flour, pre-gelatinized", "Rice, white, long grain, raw"])[0]).toBe("Rice, white, long grain, raw");
  });
  it("milk before malted or evaporated milk; but asking for malted milk finds it first", () => {
    expect(order("milk", ["Milk, malted", "Milk, evaporated, whole", "Milk, whole"])[0]).toBe("Milk, whole");
    expect(order("malted milk", ["Milk, whole", "Milk, malted"])[0]).toBe("Milk, malted");
  });
  it("USDA's NFS record, the generic one, comes first among equals", () => {
    expect(order("beef", ["Beef, brisket", "Beef, NFS", "Beef, oxtails"])[0]).toBe("Beef, NFS");
  });
  it("a mixed dish goes after the food itself, unless its other words were asked for", () => {
    expect(order("cooked rice", ["Rice, cooked, with milk", "Rice, cooked, NFS"])[0]).toBe("Rice, cooked, NFS");
    expect(order("rice with milk", ["Rice, cooked, NFS", "Rice, cooked, with milk"])[0]).toBe("Rice, cooked, with milk");
  });
  it("oatmeal before oatmeal cookies, plural or not", () => {
    expect(order("oatmeal", ["Oatmeal cookies", "Oatmeal Cookie", "Oatmeal"])[0]).toBe("Oatmeal");
    expect(order("oatmeal cookies", ["Oatmeal", "Oatmeal cookies"])[0]).toBe("Oatmeal cookies");
  });
  it("the whole egg before the white and the yolk", () => {
    expect(order("large egg", ["Eggs, Grade A, Large, egg white", "Eggs, Grade A, Large, egg whole", "Eggs, Grade A, Large, egg yolk"])[0]).toBe("Eggs, Grade A, Large, egg whole");
  });
});

describe("look-alike records", () => {
  it("later copies with the same name, brand and values sink below distinct records, and none is removed", () => {
    const a1 = { name: "Garden Vegetables", brand: "Classic", per100: full };
    const a2 = { name: "Garden Vegetables", brand: "Classic", per100: full };
    const b = { name: "Mixed Vegetables", brand: "Growers", per100: full };
    const out = rankFoods("vegetables", [a1, a2, b]);
    expect(out).toHaveLength(3);
    expect(out.indexOf(a2)).toBe(2);
    expect(out.indexOf(a1)).toBeLessThan(out.indexOf(b));
  });
  it("records that differ in brand or values aren't look-alikes", () => {
    const a = { name: "Milk", brand: "A", per100: full };
    const b = { name: "Milk", brand: "B", per100: full };
    const c = { name: "Milk", brand: "A", per100: { ...full, kcal: 64 } };
    expect(rankFoods("milk", [a, b, c])).toEqual([a, b, c]);
  });
});

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
  it("white rice: rice records before beans and rice", () => {
    const r = order("white rice", ["Beans and white rice", "Rice, white, puffed", "Rice, white, cooked, glutinous", "Rice, white, long-grain, regular, enriched, cooked"]);
    expect(r[0]).toBe("Rice, white, puffed");
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
    const input = [f("Eggs, Grade A, Large, egg white"), f("Eggs, Grade A, Large, egg whole"), f("Eggs, Grade A, Large, egg yolk")];
    const out = rankFoods("large egg", input);
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

// RC-01: what a person typing each benchmark query most likely means, written down before the ranking was changed.
// "ideal" is the plain, generic food the words name; "wrong" is a different food that merely contains the words (a
// cookie for "oatmeal", rice flour for "white rice"). Anything else is acceptable but not ideal. These judge order
// only: no provider record is changed, and nothing here ever reaches the app.
export interface Judgment { ideal: RegExp; wrong: RegExp }

export const JUDGMENTS: Record<string, { usda: Judgment; off: Judgment }> = {
  milk: {
    usda: { ideal: /^Milk, (whole|reduced fat|low ?fat|lowfat|nonfat|fat free|skim|2%|1%|NFS)\b/i, wrong: /malted|dried|dry|powder|evaporated|condensed|buttermilk|chocolate|shake|coconut|soy|almond|rice|oat|substitute|imitation|human|cracker|cookie|bread|pudding|goat|sheep|camel|buffalo/i },
    off: { ideal: /^(whole |semi[- ]skimmed |skimmed |2% |1% |reduced fat |fat free |organic )*milk$/i, wrong: /chocolate|cookie|biscuit|bar\b|candy|coconut|soy|almond|oat|rice|powder|condensed|evaporated|cheese|shake|tea|coffee|bread/i },
  },
  "whole milk": {
    usda: { ideal: /^Milk, whole\b/i, wrong: /dried|dry|powder|evaporated|condensed|chocolate|malted|cracker|bread|cheese|yogurt|ricotta/i },
    off: { ideal: /^(organic )?whole milk$/i, wrong: /chocolate|powder|condensed|evaporated|cheese|yog(h)?urt|ricotta|mozzarella|cream|ice/i },
  },
  "white rice": {
    usda: { ideal: /^(Rice, white|White rice)(?!.*(flour|puffed|cake|pudding|noodle|cereal|bran))/i, wrong: /flour|puffed|cake|pudding|noodle|cereal|crackers|bran|beverage|milk/i },
    off: { ideal: /^(long[- ]grain |jasmine |basmati |enriched |organic )*white rice$/i, wrong: /flour|cake|cracker|noodle|pudding|vinegar|cereal|puffed|bran|milk|wine/i },
  },
  "cooked rice": {
    usda: { ideal: /^(Rice|White rice|Brown rice)\b.*\bcooked\b/i, wrong: /flour|puffed|cake|pudding|noodle|cereal|crackers|bran|beverage|milk|\braw\b/i },
    off: { ideal: /^(cooked |steamed |microwave |ready )?(white |brown |jasmine |basmati |long grain )*rice( cooked| steamed)?$/i, wrong: /flour|cake|cracker|noodle|pudding|vinegar|cereal|puffed|bran|milk|wine/i },
  },
  egg: {
    usda: { ideal: /^(Eggs?, whole|Eggs?, Grade A, Large, egg whole)\b/i, wrong: /benedict|creamed|deviled|pickled|salad|substitute|noodle|roll|nog|omelet|sandwich|foo young|bread|custard|duck|goose|quail/i },
    off: { ideal: /^(large |free range |organic |medium |brown |white |cage free |pasture raised )*eggs?$/i, wrong: /noodle|pasta|chocolate|mayo|salad|sandwich|custard|nog|roll|cake|cookie|bun|bread|substitute/i },
  },
  "large egg": {
    usda: { ideal: /^(Eggs?, Grade A, Large, egg whole|Eggs?, whole)\b/i, wrong: /benedict|creamed|deviled|pickled|salad|substitute|noodle|roll|nog|omelet|sandwich|bread|custard|duck|goose|quail/i },
    off: { ideal: /^(large |free range |organic |brown |white |grade a |cage free )*large (brown |white |free range )*eggs?$/i, wrong: /noodle|pasta|chocolate|mayo|salad|sandwich|custard|roll|cake|bun|substitute/i },
  },
  "chicken breast": {
    usda: { ideal: /^(Chicken, breast|Chicken breast|Chicken, broilers or fryers, breast|Chicken, broiler.*breast)\b(?!.*(roll|breaded|coated|tenders|strips|nugget|patty|deli|lunchmeat))/i, wrong: /roll|nugget|patty|sandwich|salad|breaded|coated|frankfurter|lunchmeat|deli|soup|pot pie|baby|tenders/i },
    off: { ideal: /^(boneless |skinless |fresh |organic |free range )*chicken breasts?( fillets?)?$/i, wrong: /nugget|patty|sandwich|salad|breaded|soup|pie|wrap|strips|tenders|roll|sausage|ham|deli/i },
  },
  banana: {
    usda: { ideal: /^Bananas?, raw\b/i, wrong: /powder|dehydrated|chips|bread|pudding|split|baby|pepper|cream|muffin|cake/i },
    off: { ideal: /^(organic |fairtrade |fair trade )*bananas?$/i, wrong: /chips|bread|cake|muffin|pudding|yog(h)?urt|milk|smoothie|bar\b|candy|cookie|shake|chocolate|dried|ice/i },
  },
  oatmeal: {
    usda: { ideal: /^(Oatmeal, (NFS|regular|cooked|plain|made with)|Cereals, oats, (regular|instant|quick))/i, wrong: /cookie|bar\b|bread|muffin|cake|fast food|cereal bar|pie/i },
    off: { ideal: /^(old fashioned |quick |instant |rolled |organic |plain )*(oatmeal|oats|rolled oats|porridge oats)$/i, wrong: /cookie|biscuit|bar\b|bread|muffin|cake|cream pie|crisp|chocolate/i },
  },
  "greek yogurt": {
    usda: { ideal: /^Yogurt, Greek, plain\b/i, wrong: /with oats|frozen|dessert|bar\b|dip|dressing|smoothie|chips/i },
    off: { ideal: /^(plain |nonfat |non-fat |low[- ]fat |whole milk |full fat |0% |2% |organic )*greek yog(h)?urt( plain| natural)?$/i, wrong: /frozen|bar\b|dip|dressing|chips|smoothie|ice|dessert|pretzel|candy|bites/i },
  },
  bread: {
    usda: { ideal: /^Bread, (white|whole[- ]wheat|wheat|multigrain|multi-grain|NFS|rye|french|italian|sourdough|oatmeal)\b(?!.*(crumbs|stuffing|pudding|sticks|toast))/i, wrong: /pudding|crumbs|stuffing|sticks|fruit|zucchini|pumpkin|banana|corn|naan|puri|chapati|pita|roll|tortilla|toast|cake|crouton/i },
    off: { ideal: /^(white |whole ?wheat |wholemeal |multigrain |sourdough |rye |sliced |seeded |wholegrain |brown )*bread$/i, wrong: /crumbs|stuffing|pudding|sticks|roll|bun|croutons|toast|cake|banana bread|naan|pita|tortilla|mix|flour/i },
  },
  beef: {
    usda: { ideal: /^Beef, (ground|NFS|steak|chuck|round|loin|ribeye|sirloin|tenderloin|brisket|top sirloin|short loin)\b(?!.*(jerky|dried|stew|soup|sandwich|pot pie|baby))/i, wrong: /jerky|stew|soup|sandwich|pot pie|baby|dried|broth|bologna|frankfurter|sausage|stroganoff|burrito|taco|chili|noodle|gravy|corned/i },
    off: { ideal: /^(ground |lean |extra lean |minced |organic |grass[- ]fed )*(beef|beef mince|ground beef|minced beef)( \d+% lean)?$/i, wrong: /jerky|stew|soup|sandwich|pie|broth|stock|bologna|frank|sausage|stroganoff|burrito|taco|chili|noodle|gravy|corned|meatball|burger|stick|bouillon|flavou?r/i },
  },
};

export const SHOPPING_CATEGORIES = [
  'produce',
  'dairy',
  'meat',
  'bakery',
  'pantry',
  'frozen',
  'drinks',
  'snacks',
  'household',
  'personal',
  'baby',
  'pets',
  'other',
] as const;
export type ShoppingCategory = (typeof SHOPPING_CATEGORIES)[number];

// How long "I'm going shopping" lasts if nobody says they're done.
export const SHOPPING_TRIP_MS = 2 * 60 * 60_000;
// How long a bought item stays in view, where a tap can still take it back.
export const SHOPPING_BOUGHT_MS = 24 * 60 * 60_000;

// What makes two names the same item. Spelling only: "milk" and "חלב" stay two items.
export function shoppingKey(name: string) {
  return name
    .normalize('NFKC')
    .replace(/[֑-ׇ]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

// A pasted list or "milk, eggs" typed in one go. Bullets and checkboxes from other apps are dropped.
export function splitShoppingText(text: string) {
  return text
    .split(/[\n,;،]+/)
    .map((part) => part.replace(/^\s*(?:[-*•·▪◦☐☑✓✔]|\[[ xX]?\])\s*/, '').trim().slice(0, 80))
    .filter(Boolean);
}

const WORDS: Record<Exclude<ShoppingCategory, 'other'>, string> = {
  produce:
    'apple apples banana bananas orange oranges lemon lemons lime grapes pear pears peach peaches plum plums melon watermelon mango avocado avocados strawberries tomato tomatoes cucumber cucumbers carrot carrots potato potatoes onion onions garlic pepper peppers lettuce cabbage broccoli cauliflower zucchini eggplant spinach mushrooms parsley cilantro dill mint celery beet corn fruit vegetables salad ' +
    'תפוח תפוחים בננה בננות תפוז תפוזים לימון לימונים ענבים אגס אגסים אפרסק אפרסקים שזיף שזיפים מלון אבטיח מנגו אבוקדו תותים עגבניה עגבנייה עגבניות מלפפון מלפפונים גזר תפוחי תפו"א בצל בצלים שום פלפל פלפלים חסה כרוב ברוקולי כרובית קישוא קישואים חציל חצילים תרד פטריות פטרוזיליה כוסברה שמיר נענע סלרי סלק תירס פירות ירקות סלט',
  dairy:
    'milk butter cheese yogurt yoghurt cream eggs egg cottage labneh mozzarella parmesan ' +
    'חלב חמאה גבינה גבינות יוגורט שמנת ביצים ביצה קוטג קוטג׳ קוטג\' לבנה מוצרלה פרמזן מעדן מעדנים',
  meat:
    'chicken beef turkey lamb meat steak sausage sausages salami ham fish salmon tuna schnitzel ' +
    'עוף הודו בקר כבש בשר סטייק נקניק נקניקיות סלמי דג דגים סלמון שניצל שניצלים קציצות כרעיים חזה פרגית',
  bakery:
    'bread rolls pita pitas bagel bagels challah buns baguette cake croissant tortilla ' +
    'לחם לחמניות לחמניה פיתה פיתות בייגל חלה חלות באגט עוגה עוגות קרואסון טורטיה',
  pantry:
    'rice pasta spaghetti noodles flour sugar salt oil vinegar honey jam ketchup mayo mayonnaise mustard tahini hummus beans lentils chickpeas sauce soup cereal oats cornflakes spices paprika cumin yeast couscous quinoa ' +
    'אורז פסטה ספגטי אטריות קמח סוכר מלח שמן חומץ דבש ריבה קטשופ מיונז חרדל טחינה חומוס שעועית עדשים גרגירי רוטב מרק דגנים שיבולת קורנפלקס תבלינים פפריקה כמון שמרים קוסקוס קינואה פתיתים',
  frozen: 'frozen ice-cream popsicles קפוא קפואים קפואה גלידה ארטיק',
  drinks:
    'water juice soda cola coke beer wine coffee tea ' +
    'מים מיץ סודה קולה בירה יין קפה תה שתיה שתייה נס',
  snacks:
    'chips crackers cookies chocolate candy nuts popcorn pretzels snacks bamba bisli ' +
    'צ׳יפס ציפס קרקרים עוגיות שוקולד ממתקים אגוזים פופקורן בייגלה חטיף חטיפים במבה ביסלי',
  household:
    'detergent bleach sponge sponges foil batteries bulbs napkins towels bags softener ' +
    'אקונומיקה ספוג ספוגים נייר סוללות נורות מפיות מגבונים שקיות מרכך אבקת סבון כביסה',
  personal:
    'shampoo conditioner soap toothpaste toothbrush deodorant razor sunscreen tampons pads ' +
    'שמפו סבון משחת מברשת דאודורנט סכיני קרם תחבושות טמפונים',
  baby: 'diapers wipes formula pacifier חיתולים מטרנה מוצץ',
  pets: 'dog cat kitty litter כלב חתול חול',
};

const PHRASES: Array<[string, ShoppingCategory]> = [
  ['toilet paper', 'household'],
  ['paper towels', 'household'],
  ['dish soap', 'household'],
  ['olive oil', 'pantry'],
  ['ice cream', 'frozen'],
  ['נייר טואלט', 'household'],
  ['נייר סופג', 'household'],
  ['סבון כלים', 'household'],
  ['שמן זית', 'pantry'],
  ['דג קפוא', 'frozen'],
];

const CATEGORY_OF_WORD = new Map(
  Object.entries(WORDS).flatMap(([category, words]) => words.split(' ').map((word) => [word, category as ShoppingCategory] as const)),
);

// A first guess, which a correction replaces for good since it stays on the item's row.
// Compound names lean on their main word: the first in Hebrew (מיץ תפוזים), the last in English (orange juice).
export function guessShoppingCategory(name: string): ShoppingCategory {
  const key = shoppingKey(name);
  const phrase = PHRASES.find(([text]) => key.includes(text));
  if (phrase) return phrase[1];
  const words = key.split(' ');
  if (!/[֐-׿]/.test(key)) words.reverse();
  for (const word of words) {
    const category = CATEGORY_OF_WORD.get(word) ?? CATEGORY_OF_WORD.get(word.replace(/s$/, ''));
    if (category) return category;
  }
  return 'other';
}

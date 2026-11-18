/**
 * MenuClassifier.ts
 * Rule-based and NLP tagger for OCR-extracted cafe menu strings.
 * Automatically classifies and assigns dietary and allergen tags:
 * vegan, gluten-free, dairy-free, nut-free, and keto.
 *
 * Implements deterministic keyword matching, OCR noise sanitization,
 * negation scoping, and allergen contradiction resolution.
 */

export type DietaryTag =
    | "vegan"
    | "gluten-free"
    | "dairy-free"
    | "nut-free"
    | "keto"
    | "gluten_free"
    | "dairy_free"
    | "nut_free";

export interface ClassifyMenuItemOptions {
    /** Output tag format: "hyphen" (e.g. 'gluten-free') or "underscore" (e.g. 'gluten_free'). Defaults to 'hyphen'. */
    format?: "hyphen" | "underscore";
    /** Whether to infer implicit tags (e.g., vegan implies dairy-free if no dairy ingredients are present). Defaults to true. */
    includeImplicit?: boolean;
}

export interface MenuItemClassification {
    tags: DietaryTag[];
    confidence: Record<string, number>;
    matchedRules: string[];
    negatedRules: string[];
    allergensDetected: string[];
    rawCombinedText: string;
}

/** Normalized canonical tag names */
type CanonicalTag = "vegan" | "gluten-free" | "dairy-free" | "nut-free" | "keto";

const ORDERED_CANONICAL_TAGS: CanonicalTag[] = [
    "vegan",
    "gluten-free",
    "dairy-free",
    "nut-free",
    "keto",
];

const CANONICAL_TO_UNDERSCORE: Record<CanonicalTag, DietaryTag> = {
    vegan: "vegan",
    "gluten-free": "gluten_free",
    "dairy-free": "dairy_free",
    "nut-free": "nut_free",
    keto: "keto",
};

const CANONICAL_TO_HYPHEN: Record<CanonicalTag, DietaryTag> = {
    vegan: "vegan",
    "gluten-free": "gluten-free",
    "dairy-free": "dairy-free",
    "nut-free": "nut-free",
    keto: "keto",
};

/**
 * Sanitizes and normalizes OCR text:
 * - Replaces fancy unicode quotes and dashes
 * - Collapses repeated whitespace and OCR line breaks
 * - Normalizes letter case
 */
export function sanitizeMenuText(text?: string | null): string {
  if (!text) return "";
  return text
    .normalize("NFKD")
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-") // normalize unicode hyphens/dashes
    .replace(
      /\b(gluten|dairy|nut|peanut|tree\s*nut|plant|low|sugar|egg|meat|carb|fat)\s*-\s*(free|based|carb)\b/gi,
      "$1-$2"
    ) // normalize spaced hyphens in dietary compound terms (e.g. "Nut   -   Free" -> "Nut-Free")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'") // smart single quotes
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"') // smart double quotes
    .replace(/[\t\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Checks if a specific target word/phrase appears in the text without being preceded
 * by a plant-based/vegan/free-from qualifier (e.g., "bacon" vs "vegan bacon").
 */
function hasUnqualifiedIngredient(
    text: string,
    ingredientRegex: RegExp,
    safePrefixes: string[] = [
        "vegan",
        "plant-based",
        "plant based",
        "dairy-free",
        "dairy free",
        "gluten-free",
        "gluten free",
        "egg-free",
        "egg free",
        "meatless",
        "mock",
        "imitation",
        "beyond",
        "impossible",
        "gardein",
        "quorn",
        "non-dairy",
        "nondairy",
        "soy",
        "oat",
        "almond",
        "coconut",
        "cashew",
        "pea",
        "hemp",
        "flourless",
        "without",
        "no",
        "zero",
        "free of",
    ]
): boolean {
    const matches = text.matchAll(new RegExp(ingredientRegex, "gi"));
    for (const match of matches) {
        const matchIndex = match.index ?? 0;
        const matchLen = match[0].length;

        // Look at text before the ingredient within the immediate clause/phrase
        const rawPreceding = text.slice(Math.max(0, matchIndex - 50), matchIndex).toLowerCase();
        const clauseSplit = rawPreceding.split(/[.,;:|!]/);
        const precedingSlice = clauseSplit[clauseSplit.length - 1];

        const followingSlice = text.slice(matchIndex + matchLen, matchIndex + matchLen + 20).toLowerCase();

        // Check if followed by "-free" or " free" (e.g. "dairy-free", "gluten free", "meat-free")
        if (/^\s*[- ]\s*free\b/i.test(followingSlice)) {
            continue;
        }

        // Check if preceded by a safe modifier in the same phrase
        const isSafe = safePrefixes.some((prefix) => {
            const regex = new RegExp(`\\b${prefix}\\b`, "i");
            return regex.test(precedingSlice);
        });

        if (!isSafe) {
            return true;
        }
    }
    return false;
}

export class MenuClassifier {
    /**
     * Evaluates text against dietary rules, handles negations and contradictions,
     * and returns structured classification results.
     */
    public classifyDetailed(
        name: string,
        description?: string,
        options: ClassifyMenuItemOptions = {}
    ): MenuItemClassification {
        const { format = "hyphen", includeImplicit = true } = options;
        const cleanName = sanitizeMenuText(name);
        const cleanDesc = sanitizeMenuText(description || "");
        const combined = cleanDesc ? `${cleanName} - ${cleanDesc}` : cleanName;
        const lower = combined.toLowerCase();

        const matchedRules: string[] = [];
        const negatedRules: string[] = [];
        const allergensDetected: string[] = [];
        const confidence: Record<string, number> = {};

        if (!lower.trim()) {
            return {
                tags: [],
                confidence: {},
                matchedRules: [],
                negatedRules: [],
                allergensDetected: [],
                rawCombinedText: combined,
            };
        }

        // -------------------------------------------------------------
        // Allergen & Non-Dietary Ingredient Detection
        // -------------------------------------------------------------
        const hasDairyAllergen = hasUnqualifiedIngredient(
            lower,
            /\b(milk|cow\s*milk|dairy|cheese|cheddar|mozzarella|parmesan|butter|cream|heavy\s*cream|half\s*and\s*half|whey|casein|ghee|yogurt|yoghurt|mascarpone|ricotta|brie|feta|provolone)\b/i,
            ["vegan", "plant-based", "plant based", "dairy-free", "dairy free", "non-dairy", "nondairy", "oat", "almond", "soy", "coconut", "cashew", "pea", "hemp", "without", "no", "zero", "free of"]
        );
        if (hasDairyAllergen) allergensDetected.push("dairy");

        const hasGlutenAllergen = hasUnqualifiedIngredient(
            lower,
            /\b(wheat|barley|rye|malt|spelt|farro|semolina|bulgur|couscous|seitan|flour|breadcrumbs)\b/i,
            ["gluten-free", "gluten free", "gf", "almond", "coconut", "rice", "tapioca", "buckwheat", "without", "no", "zero", "free of"]
        );
        if (hasGlutenAllergen) allergensDetected.push("gluten");

        const hasNutAllergen = hasUnqualifiedIngredient(
            lower,
            /\b(peanuts?|peanut\s*butter|almonds?|almond\s*butter|almond\s*milk|walnuts?|cashews?|cashew\s*milk|pecans?|pistachios?|hazelnuts?|macadamias?|praline|pine\s*nuts?|marzipan|nutella|tree\s*nuts?)\b/i,
            ["nut-free", "nut free", "peanut-free", "peanut free", "without", "no", "zero", "free of"]
        );
        // Standalone "nuts" but not "nutmeg", "butternut", "doughnut", "donut", "coconut"
        const hasGenericNut = /\b(?<!cray|dough|butter|coco)nuts?\b/i.test(lower) &&
            !/\b(coconut|nutmeg|butternut|doughnut|donut)\b/i.test(lower) &&
            !/\b(nut[- ]?free|no\s+nuts|without\s+nuts|zero\s+nuts|peanut[- ]?free)\b/i.test(lower);

        if (hasNutAllergen || hasGenericNut) allergensDetected.push("nuts");

        const hasMeatAllergen = hasUnqualifiedIngredient(
            lower,
            /\b(meat|beef|steak|chicken|pork|bacon|turkey|duck|ham|lamb|sausage|prosciutto|pepperoni|salami|veal|pancetta|chorizo)\b/i,
            ["vegan", "plant-based", "plant based", "beyond", "impossible", "gardein", "quorn", "meatless", "mock", "imitation", "without", "no", "zero", "free of"]
        );
        if (hasMeatAllergen) allergensDetected.push("meat");

        const hasSeafoodAllergen = hasUnqualifiedIngredient(
            lower,
            /\b(fish|salmon|tuna|shrimp|prawns?|crab|lobster|anchov(?:y|ies)|cod|halibut|seafood)\b/i,
            ["vegan", "plant-based", "plant based", "beyond", "impossible", "gardein", "quorn", "mock", "imitation", "without", "no", "zero", "free of"]
        );
        if (hasSeafoodAllergen) allergensDetected.push("seafood");

        const hasEggAllergen = hasUnqualifiedIngredient(
            lower,
            /\b(eggs?|egg\s*yolk|egg\s*white|mayo|mayonnaise|aioli)\b/i,
            ["vegan", "plant-based", "plant based", "egg-free", "egg free", "without", "no", "zero", "free of"]
        );
        if (hasEggAllergen) allergensDetected.push("egg");

        // -------------------------------------------------------------
        // Direct Negation Scopes
        // -------------------------------------------------------------
        const isVeganNegated =
            /\b(not|never|isn't|is\s+not|non|no\s+longer|cannot\s+be\s+made|unable\s+to\s+make)\s+(?:suitable\s+for\s+)?vegans?\b/i.test(lower) ||
            /\bnon[- ]vegan\b/i.test(lower) ||
            /\bnot\s+(?:100%\s+)?vegan\b/i.test(lower) ||
            /\bcontains\s+(?:meat|chicken|beef|pork|bacon|fish|dairy|milk|cheese|eggs?)\b/i.test(lower) ||
            hasMeatAllergen ||
            hasSeafoodAllergen ||
            hasEggAllergen ||
            hasDairyAllergen;

        const isGlutenFreeNegated =
            /\b(not|never|isn't|is\s+not|cannot\s+be\s+made|unable\s+to\s+make)\s+(?:suitable\s+for\s+)?(?:gluten[- ]?free|gf|celiacs?)\b/i.test(lower) ||
            /\bnon[- ](?:gluten[- ]?free|gf)\b/i.test(lower) ||
            /\bnot\s+gluten[- ]?free\b/i.test(lower) ||
            /\bcontains?\s+(?:gluten|wheat|barley|rye)\b/i.test(lower) ||
            /\bhas\s+gluten\b/i.test(lower) ||
            /\bwith\s+gluten\b/i.test(lower) ||
            hasGlutenAllergen;

        const isDairyFreeNegated =
            /\b(not|never|isn't|is\s+not|cannot\s+be\s+made|unable\s+to\s+make)\s+(?:suitable\s+for\s+)?(?:dairy[- ]?free|df|lactose[- ]?free)\b/i.test(lower) ||
            /\bnon[- ](?:dairy[- ]?free|df)\b/i.test(lower) ||
            /\bnot\s+dairy[- ]?free\b/i.test(lower) ||
            /\bcontains?\s+(?:dairy|milk|lactose|cheese|butter|cream|whey)\b/i.test(lower) ||
            /\b(made\s+with|with)\s+real\s+(?:dairy|milk|butter|cream)\b/i.test(lower) ||
            hasDairyAllergen;

        const isNutFreeNegated =
            /\b(not|never|isn't|is\s+not)\s+(?:suitable\s+for\s+)?(?:nut[- ]?free|nf|peanut[- ]?free)\b/i.test(lower) ||
            /\bnon[- ](?:nut[- ]?free|nf)\b/i.test(lower) ||
            /\bnot\s+nut[- ]?free\b/i.test(lower) ||
            /\bcontains?\s+(?:nuts?|peanuts?|tree\s*nuts?|almonds?|walnuts?|cashews?|pecans?|pistachios?|hazelnuts?|macadamias?)\b/i.test(lower) ||
            /\bmay\s+contain\s+(?:traces?\s+(?:of\s+)?)?(?:nuts?|peanuts?|tree\s*nuts?)\b/i.test(lower) ||
            /\btraces?\s+of\s+(?:nuts?|peanuts?|tree\s*nuts?)\b/i.test(lower) ||
            /\bprocessed\s+in\s+a\s+facility\s+with\s+(?:nuts?|peanuts?)\b/i.test(lower) ||
            /\bfacility\s+(?:also\s+)?handles\s+(?:nuts?|peanuts?)\b/i.test(lower) ||
            hasNutAllergen ||
            hasGenericNut;

        const isKetoNegated =
            /\b(not|never|isn't|is\s+not)\s+(?:keto|ketogenic|low[- ]?carb|keto[- ]?friendly)\b/i.test(lower) ||
            /\bnon[- ]keto\b/i.test(lower) ||
            /\bnot\s+keto\b/i.test(lower) ||
            /\bhigh[- ]?(?:carb|carbohydrate|sugar)\b/i.test(lower) ||
            /\b(loaded\s+with|rich\s+in)\s+sugars?\b/i.test(lower);

        // Record negated rules
        if (isVeganNegated) negatedRules.push("vegan_negated");
        if (isGlutenFreeNegated) negatedRules.push("gluten_free_negated");
        if (isDairyFreeNegated) negatedRules.push("dairy_free_negated");
        if (isNutFreeNegated) negatedRules.push("nut_free_negated");
        if (isKetoNegated) negatedRules.push("keto_negated");

        // -------------------------------------------------------------
        // Extract bracketed/parenthesized badge tokens (e.g. "(V, GF, DF, NF)", "[GF/DF]")
        // -------------------------------------------------------------
        const bracketTokens = new Set<string>();
        const bracketMatches = combined.matchAll(/[\[\({\<]([^\]\)}\>]+)[\]\)}\>]/g);
        for (const bm of bracketMatches) {
            const parts = bm[1].split(/[,/|;\s]+/).map((p) => p.trim().toLowerCase());
            for (const p of parts) {
                if (p) bracketTokens.add(p);
            }
        }

        // -------------------------------------------------------------
        // Positive Dietary Rule Matching
        // -------------------------------------------------------------
        const assignedTags: Set<CanonicalTag> = new Set();

        // 1. VEGAN
        const hasExplicitVegan =
            bracketTokens.has("v") ||
            bracketTokens.has("vg") ||
            bracketTokens.has("vegan") ||
            /\bvegan\b/i.test(lower) ||
            /\b100%\s+plant\s*[-]?\s*based\b/i.test(lower) ||
            /\bplant\s*[-]?\s*based\b/i.test(lower) ||
            /(?:^|\s)🌱(?:\s|$)/.test(combined);

        if (hasExplicitVegan && !isVeganNegated) {
            assignedTags.add("vegan");
            matchedRules.push("vegan_match");
            confidence["vegan"] = 0.95;
        }

        // 2. GLUTEN-FREE
        const hasExplicitGlutenFree =
            bracketTokens.has("gf") ||
            bracketTokens.has("gluten-free") ||
            bracketTokens.has("gluten_free") ||
            /\bgluten\s*[-]?\s*free\b/i.test(lower) ||
            /\bglutenfree\b/i.test(lower) ||
            /\bno\s+gluten\b/i.test(lower) ||
            /\bwithout\s+gluten\b/i.test(lower) ||
            /\bzero\s+gluten\b/i.test(lower) ||
            /\bgluten\s*[-]?\s*friendly\b/i.test(lower) ||
            /\bcertified\s+gluten\s*[-]?\s*free\b/i.test(lower) ||
            /\bGF\b/.test(combined);

        if (hasExplicitGlutenFree && !isGlutenFreeNegated) {
            assignedTags.add("gluten-free");
            matchedRules.push("gluten_free_match");
            confidence["gluten-free"] = 0.95;
        }

        // 3. DAIRY-FREE
        const hasExplicitDairyFree =
            bracketTokens.has("df") ||
            bracketTokens.has("dairy-free") ||
            bracketTokens.has("dairy_free") ||
            /\bdairy\s*[-]?\s*free\b/i.test(lower) ||
            /\bdairyfree\b/i.test(lower) ||
            /\bnon\s*[-]?\s*dairy\b/i.test(lower) ||
            /\bnondairy\b/i.test(lower) ||
            /\blactose\s*[-]?\s*free\b/i.test(lower) ||
            /\bno\s+dairy\b/i.test(lower) ||
            /\bwithout\s+dairy\b/i.test(lower) ||
            /\bzero\s+dairy\b/i.test(lower) ||
            /\bDF\b/.test(combined);

        // Plant milk beverage without dairy
        const hasPlantMilkDrink =
            /\b(oat|almond|soy|coconut|cashew|hemp|rice|pea)\s*milk\b/i.test(lower) &&
            !hasDairyAllergen;

        if (!isDairyFreeNegated) {
            if (hasExplicitDairyFree) {
                assignedTags.add("dairy-free");
                matchedRules.push("dairy_free_match");
                confidence["dairy-free"] = 0.95;
            } else if (hasPlantMilkDrink) {
                assignedTags.add("dairy-free");
                matchedRules.push("dairy_free_plant_milk");
                confidence["dairy-free"] = 0.85;
            } else if (includeImplicit && assignedTags.has("vegan")) {
                // A verified vegan item is inherently dairy-free if no dairy contamination is flagged
                assignedTags.add("dairy-free");
                matchedRules.push("dairy_free_implicit_from_vegan");
                confidence["dairy-free"] = 0.9;
            }
        }

        // 4. NUT-FREE
        const hasExplicitNutFree =
            bracketTokens.has("nf") ||
            bracketTokens.has("nut-free") ||
            bracketTokens.has("nut_free") ||
            /\bnut\s*[-]?\s*free\b/i.test(lower) ||
            /\bnutfree\b/i.test(lower) ||
            /\bpeanut\s*[-]?\s*free\b/i.test(lower) ||
            /\btree\s*nut\s*[-]?\s*free\b/i.test(lower) ||
            /\bno\s+(?:nuts?|peanuts?)\b/i.test(lower) ||
            /\bwithout\s+(?:nuts?|peanuts?)\b/i.test(lower) ||
            /\bzero\s+(?:nuts?|peanuts?)\b/i.test(lower) ||
            /\bNF\b/.test(combined);

        if (hasExplicitNutFree && !isNutFreeNegated) {
            assignedTags.add("nut-free");
            matchedRules.push("nut_free_match");
            confidence["nut-free"] = 0.95;
        }

        // 5. KETO
        const hasExplicitKeto =
            bracketTokens.has("keto") ||
            /\bketo\b/i.test(lower) ||
            /\bketogenic\b/i.test(lower) ||
            /\bketo\s*[-]?\s*friendly\b/i.test(lower) ||
            /\blow\s*[-]?\s*carb\b/i.test(lower) ||
            /\bultra\s*low\s*[-]?\s*carb\b/i.test(lower) ||
            /\bno\s*[-]?\s*carb\b/i.test(lower) ||
            /\bzero\s*[-]?\s*carb\b/i.test(lower) ||
            /\bbulletproof\s+coffee\b/i.test(lower);

        if (hasExplicitKeto && !isKetoNegated) {
            assignedTags.add("keto");
            matchedRules.push("keto_match");
            confidence["keto"] = 0.95;
        }

        // Sort tags deterministically in stable order
        const orderedResult: DietaryTag[] = ORDERED_CANONICAL_TAGS.filter((tag) =>
            assignedTags.has(tag)
        ).map((tag) =>
            format === "underscore"
                ? CANONICAL_TO_UNDERSCORE[tag]
                : CANONICAL_TO_HYPHEN[tag]
        );

        return {
            tags: orderedResult,
            confidence,
            matchedRules,
            negatedRules,
            allergensDetected,
            rawCombinedText: combined,
        };
    }

    /**
     * Main entrypoint for classifying menu items.
     * Returns a deterministic list of dietary tags.
     */
    public classify(
        name: string,
        description?: string,
        options?: ClassifyMenuItemOptions
    ): DietaryTag[] {
        return this.classifyDetailed(name, description, options).tags;
    }
}

export const menuClassifier = new MenuClassifier();

/**
 * Convenience export required by acceptance criteria:
 * classifyMenuItem(name: string, description?: string): DietaryTag[]
 */
export function classifyMenuItem(
    name: string,
    description?: string,
    options?: ClassifyMenuItemOptions
): DietaryTag[] {
    return menuClassifier.classify(name, description, options);
}

/**
 * Detailed export providing full explainability, confidence scores, and matched rules.
 */
export function classifyMenuItemDetailed(
    name: string,
    description?: string,
    options?: ClassifyMenuItemOptions
): MenuItemClassification {
    return menuClassifier.classifyDetailed(name, description, options);
}

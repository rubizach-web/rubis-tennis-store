/**
 * Matching a store product name to a supplier catalog item.
 *
 * Names differ between the store and the suppliers ("נעלי טניס BABOLAT JET
 * MACH 3 AC BLACK-GOLD" vs "נעלי טניס בבולט Jet Mach 3 AC Men Babolat"), so we
 * compare the meaningful parts separately:
 *   - model tokens (Jet, Mach, 3, AC, 290g, gen11 ...)
 *   - audience (men / women / junior) – a mismatch is heavily penalised
 *   - colour, when both sides know it – a mismatch is heavily penalised
 */

import type { CatalogItem, LinkSuggestion } from './types.ts';

const COLOR_WORDS: Record<string, string> = {
  black: 'black', שחור: 'black', שחורה: 'black', blk: 'black', ebony: 'black',
  white: 'white', לבן: 'white', לבנה: 'white', wht: 'white', 'off-white': 'white', offwhite: 'white',
  cream: 'white', קרם: 'white', ivory: 'white',
  blue: 'blue', כחול: 'blue', כחולה: 'blue', navy: 'navy', נייבי: 'navy', 'dark blue': 'navy',
  red: 'red', אדום: 'red', אדומה: 'red', poppy: 'red',
  green: 'green', ירוק: 'green', ירוקה: 'green', olive: 'green', vetiver: 'green',
  khaki: 'khaki', חאקי: 'khaki',
  yellow: 'yellow', צהוב: 'yellow', צהובה: 'yellow',
  orange: 'orange', כתום: 'orange', כתומה: 'orange',
  pink: 'pink', ורוד: 'pink', ורודה: 'pink', fuchsia: 'pink',
  purple: 'purple', סגול: 'purple', סגולה: 'purple', lilac: 'purple', violet: 'purple', lavender: 'purple',
  grey: 'grey', gray: 'grey', אפור: 'grey', אפורה: 'grey', silver: 'silver', כסף: 'silver', כסוף: 'silver',
  gold: 'gold', זהב: 'gold', זהוב: 'gold',
  brown: 'brown', חום: 'brown', espresso: 'brown', caramel: 'brown',
  beige: 'beige', "בז'": 'beige', tofu: 'beige', sand: 'beige',
  coral: 'coral', קורל: 'coral',
  turquoise: 'turquoise', טורקיז: 'turquoise', aqua: 'turquoise',
};

type Audience = 'men' | 'women' | 'junior';
const AUDIENCE_WORDS: Record<string, Audience> = {
  men: 'men', mens: 'men', "men's": 'men', man: 'men', גברים: 'men', לגברים: 'men', גבר: 'men', male: 'men',
  women: 'women', womens: 'women', "women's": 'women', woman: 'women', wmn: 'women', lady: 'women', ladies: 'women',
  נשים: 'women', לנשים: 'women', אישה: 'women',
  junior: 'junior', jr: 'junior', juniors: 'junior', kids: 'junior', kid: 'junior', ילדים: 'junior', לילדים: 'junior',
  נוער: 'junior', boy: 'junior', girl: 'junior', boys: 'junior', girls: 'junior',
};
const GENDER_WORDS: Record<string, 'boy' | 'girl'> = { boy: 'boy', boys: 'boy', בנים: 'boy', girl: 'girl', girls: 'girl', בנות: 'girl' };

const STOP_WORDS = new Set([
  'נעלי', 'נעל', 'טניס', 'מחבט', 'מחבטי', 'תיק', 'תיקי', 'של', 'עם', 'ל', 'ה', 'ו', 'חדש', 'חדשה', 'new',
  'babolat', 'בבולט', 'באבולט', 'wilson', 'וילסון', 'ווילסון', 'yonex', 'יונקס', 'the', 'and', 'for', 'with',
  'tennis', 'tns', 'shoes', 'shoe', 'racket', 'rackets', 'racquet', 'racquets', 'rkt', 'bag', 'unstrung', 'strung',
  'ללא', 'גידים', 'גרם', 'מקורי', 'original', 'edition', 'color', 'צבע', 'דגם', 'מידה', 'size',
  // colour modifiers ("light blue", "dark grey")
  'light', 'dark', 'בהיר', 'כהה',
]);

/** Spelling slips and synonyms seen in real product names. */
const WORD_FIXES: Record<string, string> = {
  backbag: 'backpack', 'back-bag': 'backpack', bacpack: 'backpack', 'תיק-גב': 'backpack',
  raquet: 'racquet', raquets: 'racquet',
  clah: 'clash', aro: 'aero', prupulse: 'propulse', babaolat: 'babolat', ligth: 'light',
  purpel: 'purple', wimbeldon: 'wimbledon', wimbeledon: 'wimbledon',
};

/** Words that make a different model of the same family (Pro, Lite, Team, Reverse…). */
const QUALIFIERS = new Set([
  'pro', 'lite', 'light', 'team', 'tour', 'reverse', 'super', 'ul', 'ls', 'uls', 's', 'l', 'wide', 'premium',
  'classic', 'future', 'x', 'feel', 'plus', 'elite', 'mini', 'fury', 'precision',
]);

const ROMAN: Record<string, string> = { ii: '2', iii: '3', iv: '4', vi: '6', vii: '7', viii: '8' };

export interface NameParts {
  tokens: Set<string>;
  audience?: Audience;
  gender?: 'boy' | 'girl';
  colors: Set<string>;
}

export function normalizeText(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/&#8211;|&amp;|&quot;|&#039;/g, ' ')
    .replace(/ג['׳]וניור/g, ' junior ')
    // 290 גרם / 290 gr / 290g → 290g  (no \b: it does not work next to Hebrew letters)
    .replace(/(\d+)\s*(?:gr|g|גרם|גר'|גר)(?![a-z֐-׿])/g, '$1g')
    .replace(/\b(\d{2})\s*[x×\/\\]\s*(\d{2})\b/g, '$1x$2') // string pattern 16/20, 16X20 → 16x20
    .replace(/(\d+)\s*(?:pk|pack|pcs|pc)(?![a-z])/g, '$1pk') // 9PK, 9 Pack, (9PCS) → 9pk
    .replace(/\bx\s*(\d{1,2})\b/g, 'x$1') // RH X 12 → x12
    .replace(/(\d+)(?:st|nd|rd|th)\s*gen\.?/g, 'gen$1') // 8th gen. → gen8
    .replace(/\bgen\.?\s*(\d+)/g, 'gen$1') // gen 11 → gen11
    .replace(/\bv\s*(\d+)(?:\.0)?\b/g, 'v$1') // V 3 / V3.0 → v3
    .replace(/[|,;:!?()[\]{}"“”'`+*]/g, ' ')
    .replace(/[\/\\]/g, ' ')
    .replace(/(?<=[a-z֐-׿])-(?=[a-z֐-׿])/g, ' ') // black-gold → black gold
    .replace(/\s+/g, ' ')
    .trim();
}

export function nameParts(name: string, extraColor?: string): NameParts {
  const text = normalizeText(name);
  const words = text.split(' ').filter(Boolean).map(w => WORD_FIXES[w] ?? w);
  const tokens = new Set<string>();
  const colors = new Set<string>();
  let audience: Audience | undefined;
  let gender: 'boy' | 'girl' | undefined;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const two = i + 1 < words.length ? `${w} ${words[i + 1]}` : '';
    if (two && COLOR_WORDS[two]) {
      colors.add(COLOR_WORDS[two]);
      i++;
      continue;
    }
    if (COLOR_WORDS[w]) {
      colors.add(COLOR_WORDS[w]);
      continue;
    }
    if (GENDER_WORDS[w]) gender = gender ?? GENDER_WORDS[w];
    if (AUDIENCE_WORDS[w]) {
      audience = audience ?? AUDIENCE_WORDS[w];
      continue;
    }
    if (STOP_WORDS.has(w) || w.length < 1) continue;
    tokens.add(ROMAN[w] ?? w);
  }

  if (extraColor) for (const c of nameParts(extraColor).colors) colors.add(c);
  return { tokens, audience, gender, colors };
}

const isYear = (t: string) => /^20\d\d$/.test(t);
const isWeight = (t: string) => /^\d{3}g$/.test(t);
const isPattern = (t: string) => /^\d{2}x\d{2}$/.test(t);

function tokenWeight(t: string): number {
  if (isYear(t)) return 1; // model years are often missing on one side
  return /\d/.test(t) ? 2 : 1; // model numbers / weights matter most
}

/** Colour words hidden in a product URL slug (".../rush-pro-4-5-black-blue/"). */
function colorTextFromUrl(url?: string): string {
  if (!url) return '';
  try {
    const path = decodeURIComponent(new URL(url).pathname);
    return path.replace(/[-_/]+/g, ' ');
  } catch {
    return '';
  }
}

/** Similarity (≈0..1.15), with penalties for model, audience and colour conflicts. */
export function scoreMatch(storeName: string, item: Pick<CatalogItem, 'title' | 'color'> & { url?: string }): number {
  const a = nameParts(storeName);
  const b = nameParts(item.title, item.color || colorTextFromUrl(item.url));
  if (a.tokens.size === 0 || b.tokens.size === 0) return 0;

  // Suppliers that never write the weight / string pattern should not be
  // punished for it: drop those store tokens when the supplier has none.
  const supplierHasWeight = [...b.tokens].some(isWeight);
  const supplierHasPattern = [...b.tokens].some(isPattern);
  const storeTokens = new Set(
    [...a.tokens].filter(t => !(isWeight(t) && !supplierHasWeight) && !(isPattern(t) && !supplierHasPattern)),
  );
  if (storeTokens.size === 0) return 0;

  let shared = 0;
  let total = 0;
  const union = new Set([...storeTokens, ...b.tokens]);
  for (const t of union) {
    const w = tokenWeight(t);
    total += w;
    if (storeTokens.has(t) && b.tokens.has(t)) shared += w;
  }
  let score = shared / total;

  // Every model number in the store name must appear on the supplier side
  for (const t of storeTokens) if (/\d/.test(t) && !isYear(t) && !b.tokens.has(t)) score -= 0.25;
  // "Pro", "Lite", "Reverse"… on one side only means a different model
  for (const t of union) if (QUALIFIERS.has(t) && storeTokens.has(t) !== b.tokens.has(t)) score -= 0.25;

  if (a.audience && b.audience && a.audience !== b.audience) score -= 0.5;
  if (a.gender && b.gender && a.gender !== b.gender) score -= 0.5;
  if (a.colors.size && b.colors.size) {
    const overlap = [...a.colors].filter(c => b.colors.has(c)).length;
    if (overlap === 0) {
      score -= 0.4;
    } else {
      // full colour match +0.15, half match (e.g. Black/Pink for Black-Gold) ±0
      const agreement = (overlap / a.colors.size + overlap / b.colors.size) / 2;
      score += 0.3 * agreement - 0.15;
    }
  }
  // Not clamped above 1 so a colour match can still break a tie between
  // otherwise identical titles; callers clamp for display.
  return Math.max(0, score);
}

export interface RankedMatch {
  best?: LinkSuggestion;
  suggestions: LinkSuggestion[];
  /** True when the best match is clearly right and can be linked without asking. */
  confident: boolean;
  reason: string;
}

export const AUTO_LINK_MIN_SCORE = 0.62;
export const AUTO_LINK_MIN_GAP = 0.12;

export function rankCandidates(storeName: string, catalog: CatalogItem[], limit = 5): RankedMatch {
  const scored = catalog
    .map(item => ({ item, score: scoreMatch(storeName, item) }))
    .filter(x => x.score > 0.2)
    .sort((x, y) => y.score - x.score);

  const suggestions: LinkSuggestion[] = scored.slice(0, limit).map(({ item, score }) => ({
    ref: item.ref,
    url: item.url,
    title: item.title,
    color: item.color,
    score: Math.round(Math.min(1, score) * 100) / 100,
  }));

  if (suggestions.length === 0) return { suggestions, confident: false, reason: 'לא נמצא מוצר דומה אצל הספק' };

  // Compare raw (unclamped) scores
  const first = { ...suggestions[0], score: scored[0].score };
  const second = scored[1] ? { score: scored[1].score } : undefined;
  const storeColors = nameParts(storeName).colors;
  const sameTitleAsBest = scored.filter(x => x.item.title === scored[0].item.title).length;

  if (first.score < AUTO_LINK_MIN_SCORE) {
    return { best: suggestions[0], suggestions, confident: false, reason: 'ההתאמה הכי טובה לא מספיק קרובה — דרוש אישור' };
  }
  if (second && first.score - second.score < AUTO_LINK_MIN_GAP) {
    return { best: suggestions[0], suggestions, confident: false, reason: 'יש כמה מוצרים דומים אצל הספק — דרוש אישור' };
  }
  if (sameTitleAsBest > 1 && (storeColors.size === 0 || !first.color)) {
    return { best: suggestions[0], suggestions, confident: false, reason: 'לאותו דגם יש כמה צבעים אצל הספק — דרוש אישור' };
  }
  return { best: suggestions[0], suggestions, confident: true, reason: 'התאמה ודאית' };
}

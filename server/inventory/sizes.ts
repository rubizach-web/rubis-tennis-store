/**
 * Size normalisation, so that "41 1/3", "41.3", "41-1-3" and "EU 41 1/3" are
 * treated as the same shoe size, and "G2", "L2", "4 1/4" and "4 1/4 - G2" as
 * the same grip size.
 *
 * Every label is turned into a set of comparable keys; two labels match when
 * their key sets overlap.
 */

import type { SupplierSize } from './types.ts';

const GRIP_INCHES: Record<string, number> = {
  '4': 0,
  '4 1/8': 1,
  '4 1/4': 2,
  '4 3/8': 3,
  '4 1/2': 4,
  '4 5/8': 5,
};

const CLOTHING_ALIASES: Record<string, string> = {
  XXS: 'XXS',
  XS: 'XS',
  S: 'S',
  M: 'M',
  L: 'L',
  XL: 'XL',
  XXL: 'XXL',
  '2XL': 'XXL',
  XXXL: '3XL',
  '3XL': '3XL',
  XXXXL: '4XL',
  '4XL': '4XL',
  SMALL: 'S',
  MEDIUM: 'M',
  LARGE: 'L',
};

/** Rounds a shoe size so 1/3 and 2/3 steps compare reliably. */
function shoeKey(n: number): string {
  const whole = Math.floor(n + 1e-9);
  const frac = n - whole;
  let f: string;
  if (frac < 0.15) f = '0';
  else if (frac < 0.42) f = '33'; // 1/3 (also ".3")
  else if (frac < 0.58) f = '5';
  else if (frac < 0.85) f = '67'; // 2/3 (also ".6"/".7")
  else return `shoe:${whole + 1}.0`;
  return `shoe:${whole}.${f}`;
}

/** Parses "41", "41.5", "41,5", "41 1/3", "41-1-3", "41½" into a number. */
function parseNumberWithFraction(s: string): number | null {
  const t = s
    .trim()
    .replace(/^([⅓⅔½])\s*(\d{1,2})$/, '$2$1') // Wilson writes 36⅔ as "⅔36"
    .replace(/½/g, ' 1/2')
    .replace(/⅓/g, ' 1/3')
    .replace(/⅔/g, ' 2/3')
    .replace(/,/g, '.')
    .trim();

  // "41-1-3" (WooCommerce slug form)
  let m = t.match(/^(\d{1,2})-(\d)-(\d)$/);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);

  // "41 1/3"
  m = t.match(/^(\d{1,2})\s+(\d)\s*\/\s*(\d)$/);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);

  // RTL-mangled "1/3 41"
  m = t.match(/^(\d)\s*\/\s*(\d)\s+(\d{1,2})$/);
  if (m) return Number(m[3]) + Number(m[1]) / Number(m[2]);

  // "41" / "41.5"
  m = t.match(/^(\d{1,2}(?:\.\d{1,2})?)$/);
  if (m) return Number(m[1]);

  return null;
}

/**
 * Returns the comparable keys for one size label.
 * `hint` is the supplier's option name (e.g. "מידת גריפ", "Clothes size"),
 * used only to resolve a bare "0".."5".
 */
export function sizeKeys(rawLabel: string, hint = ''): string[] {
  const keys = new Set<string>();
  let label = String(rawLabel ?? '')
    .replace(/<[^>]*>/g, ' ') // stray HTML
    .replace(/\s+/g, ' ')
    .trim();
  if (!label) return [];

  // "מידת גריפ: 42 2/3" → "42 2/3"
  if (label.includes(':')) label = label.slice(label.lastIndexOf(':') + 1).trim();

  const upper = label.toUpperCase();

  // Grip: "G2", "L2", "4 1/4 - G2", "1/4 4 - G2", "4 1/4 (L2)"
  const gripCode = upper.match(/(?:^|[\s(\-])[GL]\s?([0-5])(?:$|[\s)\-])/) || upper.match(/^[GL]([0-5])$/);
  if (gripCode) keys.add(`grip:${gripCode[1]}`);

  // Hebrew "ידית 2 (1/4 4)"
  const hebrewGrip = label.match(/ידית\s*([0-5])(?![0-9])/);
  if (hebrewGrip) keys.add(`grip:${hebrewGrip[1]}`);

  // Grip in inches, possibly RTL-mangled
  const inch = upper.match(/4\s+([1357])\s*\/\s*([248])/) || upper.match(/([1357])\s*\/\s*([248])\s+4/);
  if (inch) {
    const k = GRIP_INCHES[`4 ${inch[1]}/${inch[2]}`];
    if (k !== undefined) keys.add(`grip:${k}`);
  } else if (/^4(\s?["”]|\s?INCH)?$/.test(upper)) {
    keys.add('grip:0');
  }

  // Strip region prefixes/suffixes for shoes: "EU 42", "42 EU", "מידה 42"
  const shoeText = upper
    .replace(/\b(EU|EUR|FR)\b/g, '')
    .replace(/מידה/g, '')
    .replace(/[()]/g, '')
    .trim();
  if (!/\bUS\b|\bUK\b/.test(upper)) {
    const n = parseNumberWithFraction(shoeText);
    if (n !== null) {
      if (n >= 15 && n <= 52) {
        keys.add(shoeKey(n));
      } else if (Number.isInteger(n) && n >= 0 && n <= 5) {
        const gripHint = /grip|גריפ|ידית/i.test(hint);
        const nonGripHint = /shoe|נעל|clothes|ביגוד|מידה$/i.test(hint) && !gripHint;
        if (!nonGripHint) keys.add(`grip:${n}`);
        keys.add(`num:${n}`);
      } else {
        keys.add(`num:${n}`);
      }
    }
  }

  // Clothing
  const cloth = CLOTHING_ALIASES[upper.replace(/\s+/g, '')];
  if (cloth) keys.add(`cloth:${cloth}`);

  // Always keep a plain-text key so identical free-text options (colours,
  // "UNIQ", "One size") still match each other.
  keys.add(`text:${label.toLowerCase().replace(/[\s\-_/]+/g, '')}`);

  return [...keys];
}

export function sizesMatch(a: string, b: string, hintB = ''): boolean {
  const ka = new Set(sizeKeys(a));
  return sizeKeys(b, hintB).some(k => ka.has(k));
}

export interface SizeMatchResult {
  /** The store's own size labels that can be sold. */
  available: string[];
  /** The store's own size labels that cannot be sold right now. */
  unavailable: string[];
  /** Store sizes that the supplier does not offer at all (subset of unavailable). */
  notOffered: string[];
}

/**
 * Compares the store's size list with what the supplier offers.
 * A store size is available only when a matching supplier size is available;
 * sizes the supplier does not list at all are unavailable.
 */
export function matchSizes(
  storeSizes: string[] | undefined,
  supplierSizes: SupplierSize[] | null,
  productInStock: boolean,
  hint = '',
): SizeMatchResult {
  const mine = (storeSizes || []).map(s => s.trim()).filter(Boolean);

  if (mine.length === 0) return { available: [], unavailable: [], notOffered: [] };

  // Supplier has no size choice: every store size follows the product status.
  if (supplierSizes === null) {
    return productInStock
      ? { available: [...mine], unavailable: [], notOffered: [] }
      : { available: [], unavailable: [...mine], notOffered: [] };
  }

  const result: SizeMatchResult = { available: [], unavailable: [], notOffered: [] };
  const supplierKeyed = supplierSizes.map(s => ({ ...s, keys: new Set(sizeKeys(s.label, hint)) }));

  for (const size of mine) {
    const keys = sizeKeys(size);
    const matches = supplierKeyed.filter(s => keys.some(k => s.keys.has(k)));
    if (matches.length === 0) {
      result.unavailable.push(size);
      result.notOffered.push(size);
    } else if (matches.some(s => s.available)) {
      result.available.push(size);
    } else {
      result.unavailable.push(size);
    }
  }
  return result;
}

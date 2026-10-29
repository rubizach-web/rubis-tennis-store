/**
 * Unit tests for the supplier sync logic.
 * Run with:  npm run test:inventory   (node --experimental-strip-types --test)
 *
 * Fixtures mirror the real page/API shapes seen on the three supplier sites
 * (October 2026), trimmed to the fields the code reads.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sizeKeys, sizesMatch, matchSizes } from './sizes.ts';
import { parseBabolatProduct, parseBabolatFeed } from './babolat.ts';
import { parseWooProductPage, buildStoreApiStock } from './woocommerce.ts';
import { rankCandidates, scoreMatch } from './matching.ts';
import { computeStockUpdate, detectSupplier } from './sync.ts';
import type { CatalogItem } from './types.ts';

// ---------------------------------------------------------------- sizes

test('shoe sizes in different spellings match', () => {
  assert.ok(sizesMatch('41 1/3', '41-1-3'));
  assert.ok(sizesMatch('41.3', '41 1/3'));
  assert.ok(sizesMatch('EU 42', '42'));
  assert.ok(sizesMatch('42 2/3', 'מידת גריפ: 42 2/3'));
  assert.ok(sizesMatch('40.5', '40½'));
  assert.ok(!sizesMatch('41', '41 1/3'));
  assert.ok(!sizesMatch('42', '43'));
});

test('grip sizes in different spellings match', () => {
  assert.ok(sizesMatch('G2', '4 1/4'));
  assert.ok(sizesMatch('L3', '1/4 4 - G2') === false);
  assert.ok(sizesMatch('4 1/4', '1/4 4 - G2'));
  assert.ok(sizesMatch('2', '2', 'מידת גריפ'));
  assert.ok(sizesMatch('G3', '3', 'מידת גריפ'));
  assert.ok(!sizesMatch('G3', '4', 'מידת גריפ'));
});

test('clothing sizes match', () => {
  assert.ok(sizesMatch('xl', 'XL'));
  assert.ok(sizesMatch('2XL', 'XXL'));
  assert.ok(!sizesMatch('L', 'XL'));
  assert.deepEqual(sizeKeys(''), []);
});

test('matchSizes marks sizes the supplier does not offer as unavailable', () => {
  const r = matchSizes(['40', '41', '42', '48'], [
    { label: '40', available: true },
    { label: '45', available: false },
    { label: '48', available: true },
  ], true);
  assert.deepEqual(r.available, ['40', '48']);
  assert.deepEqual(r.unavailable, ['41', '42']);
  assert.deepEqual(r.notOffered, ['41', '42']);
});

test('matchSizes follows the product status when the supplier has no sizes', () => {
  assert.deepEqual(matchSizes(['One size'], null, false).unavailable, ['One size']);
  assert.deepEqual(matchSizes(['One size'], null, true).available, ['One size']);
});

// ---------------------------------------------------------------- babolat

const babolatJetMachBlackGold = `
<html><head><title>x</title></head><body>
<div class="product-info__available">במלאי</div>
<script>
    window.product = {"id":749,"color_id":595,"name":"נעלי טניס בבולט Jet Mach 3 AC Men Babolat","description":"<p>a \\"quoted\\" {brace}</p>","options":{"options":[{"id":16,"option_type":"attr","required":true,"value_type":1,"class":"slider","name":"מידת נעליים","values":[{"id":2,"name":"40","image":""},{"id":40,"name":"45","image":""},{"id":46,"name":"48","image":""},{"id":48,"name":"49","image":""}]},{"id":17,"option_type":"attr","required":true,"value_type":3,"class":"color","name":"צבע","values":[{"id":14,"name":"Blue","image":""},{"id":595,"name":"Black/Gold","image":""}]}],"variants":{"14-40":{"product_id":449,"url":"tennis-shoes-jet-mach-3-ac-men-blue-ribbon","attr_values":[14,40],"in_stock":false},"2-595":{"product_id":749,"url":"tennis-shoes-jet-mach-3-ac-men-black-gold","attr_values":[2,595],"in_stock":false},"46-595":{"product_id":749,"url":"tennis-shoes-jet-mach-3-ac-men-black-gold","attr_values":[46,595],"in_stock":false}}},"selected":{"16":null,"17":595}};
</script></body></html>`;

test('babolat: sizes come from this colour\'s variants, ignoring the in_stock flag', () => {
  const s = parseBabolatProduct(babolatJetMachBlackGold, 'https://babolat.co.il/product/749');
  assert.equal(s.status, 'found');
  assert.equal(s.inStock, true);
  assert.equal(s.color, 'Black/Gold');
  assert.deepEqual(s.sizes, [
    { label: '40', available: true },
    { label: '45', available: false },
    { label: '48', available: true },
    { label: '49', available: false },
  ]);
});

test('babolat: a page without a product is "not found"', () => {
  const s = parseBabolatProduct('<html><body>404</body></html>', 'u');
  assert.equal(s.status, 'not_found');
  assert.equal(s.inStock, false);
});

test('babolat: racquet add-ons (stringing/cover) are not sizes', () => {
  const html = `<script>window.product = {"id":991,"name":"Pure Aero Rafa","options":{"options":[
    {"id":5,"option_type":"attr","class":"slider","name":"מידת גריפ","values":[{"id":75,"name":"3"},{"id":76,"name":"4"},{"id":74,"name":"2"}]},
    {"id":"ov","option_type":"option","class":"select","name":"שיזור","values":[{"id":"ov32","name":"ללא גידים "}]}],
    "variants":{"75":{"product_id":991,"attr_values":[75]},"75-ov32":{"product_id":991,"attr_values":[75]},"76":{"product_id":991,"attr_values":[76]}}}};</script>`;
  const s = parseBabolatProduct(html, 'u');
  assert.deepEqual(s.sizes, [
    { label: '3', available: true },
    { label: '4', available: true },
    { label: '2', available: false },
  ]);
});

test('babolat feed parses into catalog items', () => {
  const xml = `<rss><channel><item><g:title>נעלי טניס בבולט Jet Mach 3 AC Men Babolat</g:title><g:link>https://babolat.co.il/product/749</g:link><g:id>749</g:id><g:mpn>30S21629-2031</g:mpn><g:availability>in_stock</g:availability></item></channel></rss>`;
  const items = parseBabolatFeed(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].ref, '749');
  assert.equal(items[0].url, 'https://babolat.co.il/product/749');
});

// ---------------------------------------------------------------- woocommerce page (tennis-online)

function wooPage(classes: string, variations: unknown, options: string[]) {
  const json = JSON.stringify(variations).replace(/"/g, '&quot;');
  return `<div id="product-10198" class="product type-product post-10198 ${classes} product_cat-shoes">
  <h1 class="product_title entry-title">YONEX SONICAGE Men Black</h1>
  <form class="variations_form cart" data-product_variations="${json}">
  <table class="variations"><tr><th class="label"><label for="size">מידה</label></th><td class="value">
  <select id="size" name="attribute_%d7%9e%d7%99%d7%93%d7%94"><option value="">בחירת אפשרות</option>
  ${options.map(o => `<option value="${o}" class="attached enabled">${o}</option>`).join('')}
  </select></td></tr></table></form></div>`;
}

test('tennis-online: per-size stock from data-product_variations', () => {
  const html = wooPage('instock', [
    { attributes: { 'attribute_%d7%9e%d7%99%d7%93%d7%94': '41' }, is_in_stock: true, is_purchasable: true, variation_is_active: true },
    { attributes: { 'attribute_%d7%9e%d7%99%d7%93%d7%94': '42' }, is_in_stock: false, is_purchasable: true, variation_is_active: true },
  ], ['41', '42', '43']);
  const s = parseWooProductPage(html, 'u', 'טניס אונליין');
  assert.equal(s.status, 'found');
  assert.equal(s.inStock, true);
  assert.equal(s.title, 'YONEX SONICAGE Men Black');
  assert.deepEqual(s.sizes, [
    { label: '41', available: true },
    { label: '42', available: false },
    { label: '43', available: false },
  ]);
  assert.equal(s.sizeHint, 'מידה');
});

test('tennis-online: out-of-stock simple product', () => {
  const html = `<div id="product-10220" class="product type-product outofstock"><h1 class="product_title">VCORE PLAY</h1><p class="stock out-of-stock">המלאי אזל</p></div>`;
  const s = parseWooProductPage(html, 'u', 'טניס אונליין');
  assert.equal(s.status, 'found');
  assert.equal(s.inStock, false);
  assert.equal(s.sizes, null);
});

test('tennis-online: missing product page is not found', () => {
  assert.equal(parseWooProductPage('<html>nothing</html>', 'u', 'x').status, 'not_found');
});

// ---------------------------------------------------------------- woocommerce store api (wilson)

test('wilson: store API combines product + variations', () => {
  const product = {
    id: 41734, name: 'נעלי טניס | Cotrt Glide', permalink: 'https://wilson.co.il/product/x/', type: 'variable', is_in_stock: true,
    attributes: [
      { id: 1, name: 'מידת גריפ', taxonomy: 'pa_grip-size', has_variations: true, terms: [
        { id: 1, name: '41 1/3', slug: '41-1-3' }, { id: 2, name: '42', slug: '42' }, { id: 3, name: '42 2/3', slug: '990' }, { id: 4, name: '44 1/3', slug: '44-1-3' },
      ] },
      { id: 2, name: 'צבע', taxonomy: 'pa_color', has_variations: false, terms: [{ id: 9, name: 'שחור', slug: 'black' }] },
    ],
    variations: [
      { id: 41739, attributes: [{ name: 'מידת גריפ', value: '41-1-3' }] },
      { id: 41735, attributes: [{ name: 'מידת גריפ', value: '42' }] },
      { id: 41742, attributes: [{ name: 'מידת גריפ', value: '990' }] },
    ],
  };
  const variations = [
    { id: 41739, is_in_stock: true },
    { id: 41735, is_in_stock: false },
    { id: 41742, is_in_stock: true },
  ];
  const s = buildStoreApiStock(product, variations, 'וילסון');
  assert.equal(s.inStock, true);
  assert.equal(s.color, 'שחור');
  assert.deepEqual(s.sizes, [
    { label: '41 1/3', available: true },
    { label: '42', available: false },
    { label: '42 2/3', available: true },
    { label: '44 1/3', available: false },
  ]);
  const upd = computeStockUpdate({ id: 'p', name: 'x', sizes: ['41.3', '42', '42 2/3', '44'] }, s);
  assert.equal(upd.inStock, true);
  assert.deepEqual(upd.unavailableSizes, ['42', '44']);
});

// ---------------------------------------------------------------- matching

const jetMach: CatalogItem[] = [
  { supplier: 'babolat', ref: '449', url: 'u449', title: 'נעלי טניס בבולט Jet Mach 3 AC Men Babolat', color: 'Blue' },
  { supplier: 'babolat', ref: '749', url: 'u749', title: 'נעלי טניס בבולט Jet Mach 3 AC Men Babolat', color: 'Black/Gold' },
  { supplier: 'babolat', ref: '1166', url: 'u1166', title: 'נעלי טניס בבולט Jet Mach 3 AC Men WIDE Babolat', color: 'Black/White' },
  { supplier: 'babolat', ref: '900', url: 'u900', title: 'נעלי טניס בבולט Jet Mach 3 AC Women Babolat', color: 'Black/Pink' },
  { supplier: 'babolat', ref: '1', url: 'u1', title: 'נעלי טניס בבולט SFX4 AC Babolat', color: 'Grey/White' },
  { supplier: 'babolat', ref: '2', url: 'u2', title: 'מחבט טניס בבולט 290 גרם Pure Aero Rafa 2023' },
  { supplier: 'babolat', ref: '3', url: 'u3', title: 'מחבט טניס בבולט 300 גרם Pure Aero 2023 Babolat' },
];

test('the Jet Mach 3 Black-Gold links to the right colour', () => {
  const r = rankCandidates('נעלי טניס BABOLAT JET MACH 3 AC BLACK-GOLD', jetMach);
  assert.equal(r.best?.ref, '749');
  assert.equal(r.confident, true);
});

test('without a colour in the name, several colours need approval', () => {
  const r = rankCandidates('Babolat Jet Mach 3 AC Men', jetMach);
  assert.equal(r.confident, false);
});

test('weights distinguish racquets', () => {
  assert.ok(scoreMatch('Babolat Pure Aero Rafa 290g', jetMach[5]) > scoreMatch('Babolat Pure Aero Rafa 290g', jetMach[6]));
  const r = rankCandidates('מחבט Babolat Pure Aero 2023 300 גרם', jetMach);
  assert.equal(r.best?.ref, '3');
});

// ---------------------------------------------------------------- supplier detection

test('detects suppliers by site, brand and model', () => {
  assert.equal(detectSupplier({ id: '1', name: 'x', supplierSite: 'BABOLAT ISRAEL' }), 'babolat');
  assert.equal(detectSupplier({ id: '1', name: 'x', supplierSite: 'sportcenter' }), 'manual');
  assert.equal(detectSupplier({ id: '1', name: 'מחבט YONEX EZONE 100' }), 'yonex');
  assert.equal(detectSupplier({ id: '1', name: 'Pro Staff 97 v14' }), 'wilson');
  assert.equal(detectSupplier({ id: '1', name: 'HEAD Speed MP' }), 'manual');
  assert.equal(detectSupplier({ id: '1', name: 'גריפ כללי' }), null);
});

// ---------------------------------------------------------------- stock update

test('Jet Mach Black/Gold: only 40 and 48 can be sold', () => {
  const s = parseBabolatProduct(babolatJetMachBlackGold, 'u');
  const upd = computeStockUpdate({ id: 'p', name: 'x', sizes: ['40', '41', '42', '43', '44', '45', '48'] }, { ...s, sizeHint: 'מידת נעליים' });
  assert.equal(upd.inStock, true);
  assert.deepEqual(upd.unavailableSizes, ['41', '42', '43', '44', '45']);
  assert.deepEqual(upd.supplierSizes, ['40', '48']);
});

test('supplier errors and removed products hide the product', () => {
  const err = computeStockUpdate({ id: 'p', name: 'x', sizes: ['40'] }, { status: 'error', inStock: false, sizes: null, url: 'u', detail: 'timeout' });
  assert.equal(err.inStock, false);
  assert.equal(err.stockCheckState, 'error');
  const gone = computeStockUpdate({ id: 'p', name: 'x' }, { status: 'not_found', inStock: false, sizes: null, url: 'u', detail: 'gone' });
  assert.equal(gone.inStock, false);
  assert.equal(gone.stockCheckState, 'not_found');
});

test('a product whose sizes are all sold out is out of stock', () => {
  const upd = computeStockUpdate({ id: 'p', name: 'x', sizes: ['41', '42'] }, {
    status: 'found', inStock: true, url: 'u', detail: '', sizes: [{ label: '41', available: false }, { label: '43', available: true }],
  });
  assert.equal(upd.inStock, false);
});

// ---------------------------------------------------------------- full product sync (with fake suppliers)

import { syncOneProduct } from './run.ts';

const fakeStock = (sizes: { label: string; available: boolean }[] | null, inStock = true) => async () => ({
  status: 'found' as const, inStock, sizes, url: 'https://babolat.co.il/product/749', title: 'Jet Mach 3 AC Men', color: 'Black/Gold', detail: 'ok', sizeHint: '',
});

test('unlinked product gets linked automatically and checked', async () => {
  const r = await syncOneProduct(
    { id: 'p1', name: 'נעלי טניס BABOLAT JET MACH 3 AC BLACK-GOLD', sizes: ['40', '42'], inStock: false },
    {},
    {
      decideLink: async () => ({ supplier: 'babolat', status: 'auto', ref: '749', url: 'https://babolat.co.il/product/749', suggestions: [], reason: 'התאמה ודאית' }),
      fetchStock: fakeStock([{ label: '40', available: true }, { label: '48', available: true }]),
    },
  );
  assert.equal(r.outcome, 'linked');
  assert.equal(r.fields.supplierRef, '749');
  assert.equal(r.fields.supplierLinkStatus, 'auto');
  assert.equal(r.newInStock, true);
  assert.deepEqual(r.newUnavailable, ['42']);
});

test('uncertain link leaves stock untouched and stores suggestions', async () => {
  const r = await syncOneProduct(
    { id: 'p2', name: 'Babolat Jet Mach 3', inStock: true },
    {},
    {
      decideLink: async () => ({ supplier: 'babolat', status: 'suggested', suggestions: [{ ref: '1', url: 'u', title: 't', score: 0.8 }], reason: 'דרוש אישור' }),
      fetchStock: async () => { throw new Error('should not be called'); },
    },
  );
  assert.equal(r.outcome, 'needs_link');
  assert.equal(r.fields.inStock, undefined);
  assert.equal(r.fields.supplierSuggestions?.length, 1);
});

test('confirmed link is not re-decided', async () => {
  const r = await syncOneProduct(
    { id: 'p3', name: 'Pro Staff 97', supplierSite: 'wilson', supplierRef: '123', supplierLinkStatus: 'confirmed', sizes: ['G2', 'G3'] },
    {},
    {
      decideLink: async () => { throw new Error('should not relink'); },
      fetchStock: fakeStock([{ label: '4 1/4', available: false }, { label: '4 3/8', available: true }]),
    },
  );
  assert.equal(r.outcome, 'checked');
  assert.deepEqual(r.newUnavailable, ['G2']);
});

test('manual suppliers are skipped', async () => {
  const r = await syncOneProduct(
    { id: 'p4', name: 'HEAD Speed MP', inStock: true },
    {},
    { decideLink: async () => { throw new Error('no'); }, fetchStock: async () => { throw new Error('no'); } },
  );
  assert.equal(r.outcome, 'manual');
  assert.equal(r.fields.inStock, undefined);
});

test('Hebrew weights and string patterns are normalised', () => {
  const pd = { title: 'מחבט טניס בבולט 300 גרם Pure Drive Gen11 Babolat' };
  const pdTeam = { title: 'מחבט טניס בבולט 285 גרם Pure Drive Team Gen11 Babolat' };
  assert.ok(scoreMatch('מחבט טניס Babolat Pure Drive 2025 300g', pd) > scoreMatch('מחבט טניס Babolat Pure Drive 2025 300g', pdTeam));
  const s1 = { title: 'מחבט טניס בבולט 305 גרם Pure Strike 100 16/20 Gen4 2024 Babolat' };
  const s2 = { title: 'מחבט טניס בבולט 300 גרם Pure Strike 100 Gen4 2024 Babolat' };
  assert.ok(scoreMatch('BABOLAT PURE STRIKE 100 16X20', s1) > scoreMatch('BABOLAT PURE STRIKE 100 16X20', s2));
});

test('an unreachable supplier catalog leaves stock unchanged', async () => {
  const r = await syncOneProduct(
    { id: 'p5', name: 'Babolat Jet Mach 3 Black', inStock: true },
    {},
    { decideLink: async () => { throw new Error('fetch failed'); }, fetchStock: async () => { throw new Error('no'); } },
  );
  assert.equal(r.outcome, 'error');
  assert.equal(r.fields.inStock, undefined);
  assert.equal(r.newInStock, true);
});

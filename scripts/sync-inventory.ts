/**
 * Daily supplier stock sync — runs on GitHub Actions (see
 * .github/workflows/inventory-sync.yml), not in the browser.
 *
 *   node --experimental-strip-types scripts/sync-inventory.ts [--dry-run] [--only=<productId>] [--relink]
 *
 * Needs the FIREBASE_SERVICE_ACCOUNT environment variable: the JSON key of a
 * Firebase service account for the store's project (stored as a GitHub secret).
 */

import { readFileSync, appendFileSync } from 'node:fs';
import { syncOneProduct, type ProductSyncResult } from '../server/inventory/run.ts';
import { SUPPLIER_INFO } from '../server/inventory/types.ts';
import { detectSupplier, clearCatalogFailures } from '../server/inventory/sync.ts';

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run') || process.env.DRY_RUN === 'true';
const RELINK = args.has('--relink') || process.env.RELINK === 'true';
const ONLY = [...args].find(a => a.startsWith('--only='))?.slice('--only='.length) || process.env.ONLY_PRODUCT || '';
const RETRY_DELAY_MS = Number(process.env.RETRY_DELAY_MS ?? 90_000);

const config = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url), 'utf8'));

async function openDb() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT is not set. Add the Firebase service-account JSON as a GitHub secret with that name.',
    );
  }
  // firebase-admin is installed only in the sync job (not a site dependency),
  // so it is loaded by name at runtime.
  const appModule = 'firebase-admin/app';
  const firestoreModule = 'firebase-admin/firestore';
  const { initializeApp, cert } = await import(appModule);
  const { getFirestore } = await import(firestoreModule);
  const credentials = JSON.parse(raw);
  const app = initializeApp({ credential: cert(credentials), projectId: config.projectId });
  return getFirestore(app, config.firestoreDatabaseId);
}

function log(...a: unknown[]) {
  console.log(new Date().toISOString().slice(11, 19), ...a);
}

async function main() {
  const db = await openDb();
  const snap = await db.collection('products').get();
  let products: any[] = snap.docs.map((d: any) => ({ ...(d.data() as any), id: d.id }));
  if (ONLY) products = products.filter((p: any) => p.id === ONLY);
  log(`Loaded ${products.length} products${DRY_RUN ? ' (dry run — nothing will be written)' : ''}`);

  // One worker per supplier so each site is visited politely, in sequence.
  const queues = new Map<string, any[]>();
  for (const p of products) {
    const key = String(detectSupplier(p) ?? 'other');
    if (!queues.has(key)) queues.set(key, []);
    queues.get(key)!.push(p);
  }

  const results = new Map<string, ProductSyncResult>();
  async function runQueue(list: any[]) {
    for (const p of list) {
      try {
        const r = await syncOneProduct(p, { relink: RELINK });
        results.set(p.id, r);
        log(`${r.outcome.padEnd(16)} ${p.name}`);
      } catch (err: any) {
        log(`crash            ${p.name}: ${err?.message ?? err}`);
      }
    }
  }
  await Promise.all([...queues.values()].map(runQueue));

  // Suppliers sometimes time out briefly — give errors one more chance.
  const errored = products.filter((p: any) => results.get(p.id)?.outcome === 'error');
  if (errored.length) {
    log(`Retrying ${errored.length} products that failed, in ${RETRY_DELAY_MS / 1000}s`);
    await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    clearCatalogFailures();
    await runQueue(errored);
  }

  // Write
  let writes = 0;
  const changes: ProductSyncResult[] = [];
  for (const p of products) {
    const r = results.get(p.id);
    if (!r) continue;
    if (r.previousInStock !== r.newInStock || JSON.stringify(r.previousUnavailable) !== JSON.stringify(r.newUnavailable)) {
      changes.push(r);
    }
    if (DRY_RUN) continue;
    // Every product gets a fresh "last checked" time, so always write.
    await db.collection('products').doc(p.id).update(r.fields as any);
    writes++;
  }

  const all = [...results.values()];
  const count = (o: string) => all.filter(r => r.outcome === o).length;
  const summary = {
    startedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    total: products.length,
    checked: count('checked') + count('linked'),
    linkedNow: count('linked'),
    needsLink: count('needs_link'),
    unknownSupplier: count('unknown_supplier'),
    manual: count('manual'),
    notFound: count('not_found'),
    errors: count('error'),
    inStock: all.filter(r => r.newInStock).length,
    outOfStock: all.filter(r => !r.newInStock).length,
    changes: changes.slice(0, 200).map(r => ({
      productId: r.productId,
      productName: r.productName,
      supplier: r.supplier ?? null,
      outcome: r.outcome,
      before: r.previousInStock,
      after: r.newInStock,
      unavailableSizes: r.newUnavailable,
      detail: r.fields.stockStatusDetail ?? '',
    })),
    writes,
  };

  if (!DRY_RUN) {
    try {
      await db.collection('syncRuns').doc(summary.startedAt.replace(/[:.]/g, '-')).set(summary);
    } catch (err: any) {
      log('Could not save the run report:', err?.message ?? err);
    }
  }

  log(JSON.stringify({ ...summary, changes: summary.changes.length }, null, 2));
  writeStepSummary(summary, all);

  // Fail the run (so GitHub e-mails the owner) only when a supplier is fully down.
  const bySupplier = new Map<string, { ok: number; err: number }>();
  for (const r of all) {
    if (!r.supplier) continue;
    const s = bySupplier.get(r.supplier) ?? { ok: 0, err: 0 };
    if (r.outcome === 'error') s.err++;
    else if (r.outcome === 'checked' || r.outcome === 'linked' || r.outcome === 'not_found') s.ok++;
    bySupplier.set(r.supplier, s);
  }
  const down = [...bySupplier.entries()].filter(([, s]) => s.err > 0 && s.ok === 0).map(([k]) => k);
  if (down.length) {
    console.error(`Supplier(s) not reachable at all: ${down.join(', ')}`);
    process.exitCode = 1;
  }
}

function writeStepSummary(summary: any, all: ProductSyncResult[]) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  const name = (id?: string) => (id && (SUPPLIER_INFO as any)[id]?.name) || '—';
  const lines = [
    `## סנכרון מלאי ${summary.dryRun ? '(הרצת ניסיון — לא נשמר)' : ''}`,
    '',
    `| | |`,
    `|---|---|`,
    `| מוצרים | ${summary.total} |`,
    `| נבדקו מול ספק | ${summary.checked} |`,
    `| קושרו אוטומטית הפעם | ${summary.linkedNow} |`,
    `| מחכים לאישור קישור | ${summary.needsLink} |`,
    `| ספק לא זוהה | ${summary.unknownSupplier} |`,
    `| ספק ידני | ${summary.manual} |`,
    `| הוסרו אצל הספק | ${summary.notFound} |`,
    `| תקלות גישה | ${summary.errors} |`,
    `| במלאי / אזלו | ${summary.inStock} / ${summary.outOfStock} |`,
    '',
    `### שינויים (${summary.changes.length})`,
    '',
    '| מוצר | ספק | לפני | אחרי | מידות שאזלו |',
    '|---|---|---|---|---|',
    ...summary.changes.map((c: any) =>
      `| ${c.productName} | ${name(c.supplier)} | ${c.before ? 'במלאי' : 'אזל'} | ${c.after ? 'במלאי' : 'אזל'} | ${c.unavailableSizes.join(', ')} |`,
    ),
    '',
    '### מחכים לאישור קישור',
    '',
    ...all.filter(r => r.outcome === 'needs_link').map(r => `- ${r.productName} — ${r.fields.supplierLinkReason ?? ''}`),
  ];
  appendFileSync(file, lines.join('\n') + '\n');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

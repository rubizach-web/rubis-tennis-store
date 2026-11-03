/**
 * One-time move of product photos out of Firestore (see server/images.ts).
 *
 *   node --experimental-strip-types scripts/migrate-images.ts [--dry-run]
 *
 * --dry-run only measures: how many photos are embedded and how large the
 * documents are. Without it, every embedded photo is uploaded to the images
 * repository and the document is updated to point at it.
 *
 * Needs FIREBASE_SERVICE_ACCOUNT, and GITHUB_IMAGES_TOKEN unless --dry-run.
 */
import { readFileSync, appendFileSync } from 'node:fs';
import { externalizeImages, measureEmbedded, IMAGES_REPO } from '../server/images.ts';

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === 'true';
const config = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url), 'utf8'));

async function openDb() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');
  const appModule = 'firebase-admin/app';
  const firestoreModule = 'firebase-admin/firestore';
  const { initializeApp, cert } = await import(appModule);
  const { getFirestore } = await import(firestoreModule);
  const app = initializeApp({ credential: cert(JSON.parse(raw)), projectId: config.projectId });
  return getFirestore(app, config.firestoreDatabaseId);
}

const kb = (n: number) => `${Math.round(n / 1024).toLocaleString()} KB`;

async function main() {
  const db = await openDb();
  const docs: { ref: any; label: string; data: any }[] = [];
  const content = await db.collection('settings').doc('content').get();
  if (content.exists) docs.push({ ref: content.ref, label: 'settings/content', data: content.data() });
  const products = await db.collection('products').get();
  for (const d of products.docs) docs.push({ ref: d.ref, label: d.data().name || d.id, data: d.data() });

  let totalBytes = 0;
  let embeddedBytes = 0;
  let embeddedCount = 0;
  const rows: { label: string; size: number; images: number }[] = [];
  for (const d of docs) {
    const size = JSON.stringify(d.data).length;
    const m = measureEmbedded(d.data);
    totalBytes += size;
    embeddedBytes += m.bytes;
    embeddedCount += m.count;
    rows.push({ label: d.label, size, images: m.count });
  }
  rows.sort((a, b) => b.size - a.size);
  console.log(`Documents: ${docs.length}, total ${kb(totalBytes)}, embedded photos: ${embeddedCount} (${kb(embeddedBytes)})`);
  console.log(`Read units for one full catalog read ≈ ${Math.round(totalBytes / 4096).toLocaleString()} (at 4 KB per unit)`);
  rows.slice(0, 15).forEach(r => console.log(`  ${kb(r.size).padStart(9)}  ${r.images} photos  ${r.label}`));

  const summary = [
    `## תמונות בתוך בסיס הנתונים ${DRY_RUN ? '(בדיקה בלבד)' : ''}`,
    '',
    `| | |`,
    `|---|---|`,
    `| מסמכים | ${docs.length} |`,
    `| נפח כולל | ${kb(totalBytes)} |`,
    `| תמונות מוטמעות | ${embeddedCount} (${kb(embeddedBytes)}) |`,
    `| יחידות קריאה לטעינה מלאה אחת (בערך) | ${Math.round(totalBytes / 4096).toLocaleString()} |`,
    '',
  ];

  if (!DRY_RUN) {
    let moved = 0;
    let failed = 0;
    for (const d of docs) {
      if (measureEmbedded(d.data).count === 0) continue;
      try {
        const updated = await externalizeImages(d.data, () => moved++);
        await d.ref.set(updated);
        console.log(`moved photos of ${d.label}`);
      } catch (err: any) {
        failed++;
        console.log(`::warning::${d.label}: ${err?.message ?? err}`);
      }
    }
    summary.push(`הועברו ${moved} תמונות אל ${IMAGES_REPO}. נכשלו: ${failed} מסמכים.`);
    console.log(`Moved ${moved} photos, ${failed} documents failed`);
    if (failed) process.exitCode = 1;
  }

  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join('\n') + '\n');
}

main().catch(err => {
  console.error(err);
  console.log(`::error::${String(err?.message ?? err)}`);
  process.exit(1);
});

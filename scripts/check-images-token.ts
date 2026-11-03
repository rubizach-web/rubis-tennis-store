/** Checks that IMAGES_TOKEN can write to the images repository (no database access). */
import { IMAGES_REPO } from '../server/images.ts';

const token = process.env.GITHUB_IMAGES_TOKEN;
if (!token) {
  console.log('::error::הסוד IMAGES_TOKEN לא נמצא בהגדרות המאגר rubis-tennis-store');
  process.exit(1);
}
const res = await fetch(`https://api.github.com/repos/${IMAGES_REPO}`, {
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'rubis-tennis-store' },
});
if (res.status === 401) {
  console.log('::error::המפתח לא תקין או שפג תוקפו — צור מפתח חדש');
  process.exit(1);
}
if (res.status === 404) {
  console.log(`::error::המפתח לא רואה את המאגר ${IMAGES_REPO} — ודא שהמאגר קיים ושהמפתח קיבל גישה אליו`);
  process.exit(1);
}
const repo = (await res.json()) as { private: boolean; permissions?: { push?: boolean } };
const problems: string[] = [];
if (repo.private) problems.push('המאגר מוגדר פרטי — צריך להיות Public כדי שהתמונות יוצגו באתר');
if (!repo.permissions?.push) problems.push('למפתח אין הרשאת כתיבה — ב-Contents צריך לבחור Read and write');
if (problems.length) {
  problems.forEach(p => console.log(`::error::${p}`));
  process.exit(1);
}
console.log(`::notice::הכל תקין: המפתח יכול לשמור תמונות במאגר הציבורי ${IMAGES_REPO}`);

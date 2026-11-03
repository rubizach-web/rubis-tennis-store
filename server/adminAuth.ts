/**
 * Checks that a request comes from a signed-in store admin, using the Firebase
 * ID token the admin's browser sends. Verified with Google's Identity Toolkit
 * (no service account needed on the server).
 */
import firebaseConfig from '../firebase-applet-config.json';

const ADMIN_EMAILS = ['rubizach@gmail.com', 'omerle009@gmail.com'];

export async function requireAdmin(authorization?: string): Promise<string> {
  const idToken = (authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!idToken) throw Object.assign(new Error('נדרשת התחברות כמנהל'), { status: 401 });
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent((firebaseConfig as any).apiKey)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }) },
  );
  if (!res.ok) throw Object.assign(new Error('ההתחברות פגה — התחבר מחדש'), { status: 401 });
  const body = (await res.json()) as { users?: { email?: string; emailVerified?: boolean }[] };
  const user = body.users?.[0];
  const email = user?.email?.toLowerCase() ?? '';
  if (!user?.emailVerified || !ADMIN_EMAILS.includes(email)) {
    throw Object.assign(new Error('אין הרשאת מנהל'), { status: 403 });
  }
  return email;
}

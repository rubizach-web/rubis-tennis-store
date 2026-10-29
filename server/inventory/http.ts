/**
 * Small polite HTTP helper: browser-like headers, a timeout, one retry, and a
 * minimum gap between requests to the same host so supplier sites are not
 * hammered.
 */

const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control': 'no-cache',
};

const MIN_GAP_MS = Number(process.env.SUPPLIER_REQUEST_GAP_MS ?? 400);
const lastRequestAt = new Map<string, number>();

async function waitForHost(url: string) {
  const host = new URL(url).host;
  const last = lastRequestAt.get(host) ?? 0;
  const wait = last + MIN_GAP_MS - Date.now();
  lastRequestAt.set(host, Math.max(Date.now(), last + MIN_GAP_MS));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
    this.status = status;
  }
}

async function request(url: string, accept: string, timeoutMs: number): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    await waitForHost(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { ...HEADERS, Accept: accept },
        signal: controller.signal,
        redirect: 'follow',
      });
      // 404/410 are answers, not failures; only retry server errors.
      if (res.status >= 500 && attempt === 0) {
        lastErr = new HttpError(res.status, url);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function getText(url: string, timeoutMs = 25000): Promise<{ status: number; text: string; finalUrl: string }> {
  const res = await request(url, 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', timeoutMs);
  return { status: res.status, text: await res.text(), finalUrl: res.url || url };
}

export async function getJson<T = unknown>(url: string, timeoutMs = 25000): Promise<{ status: number; data: T | null; headers: Headers }> {
  const res = await request(url, 'application/json', timeoutMs);
  let data: T | null = null;
  try {
    data = (await res.json()) as T;
  } catch {
    data = null;
  }
  return { status: res.status, data, headers: res.headers };
}

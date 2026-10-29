/**
 * Safe JSON response parser that prevents "Unexpected token '<', <html>" errors
 * when endpoints return HTML (such as server error pages, redirects or 404s).
 */
export async function safeFetchJson<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; data?: T; error?: string; isConfigError?: boolean }> {
  try {
    const response = await fetch(input, init);
    const contentType = response.headers.get('content-type') || '';

    let parsedData: any = null;
    let rawText = '';

    if (contentType.includes('application/json')) {
      try {
        parsedData = await response.json();
      } catch (jsonErr: any) {
        console.warn('Failed to parse JSON response despite application/json header', jsonErr);
      }
    } else {
      rawText = await response.text();
      try {
        parsedData = JSON.parse(rawText);
      } catch {
        // rawText is not JSON (e.g., plain HTML/text)
      }
    }

    if (!response.ok) {
      const errorMessage = parsedData?.error || parsedData?.message || (rawText.length > 0 && rawText.length < 200 ? rawText : `שגיאת שרת (${response.status})`);
      return {
        ok: false,
        status: response.status,
        error: errorMessage,
        isConfigError: Boolean(parsedData?.isConfigError),
        data: parsedData
      };
    }

    return {
      ok: true,
      status: response.status,
      data: parsedData !== null ? (parsedData as T) : (rawText as unknown as T)
    };
  } catch (netErr: any) {
    console.error('Network/Fetch error:', netErr);
    return {
      ok: false,
      status: 0,
      error: netErr.message || 'שגיאת תקשורת עם השרת'
    };
  }
}

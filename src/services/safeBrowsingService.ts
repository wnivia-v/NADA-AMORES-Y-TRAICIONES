// =============================================================================
// Google Safe Browsing API v4
// Checks URLs against MALWARE, SOCIAL_ENGINEERING, UNWANTED_SOFTWARE threats
// =============================================================================

interface SafeBrowsingResult {
  safe: boolean;
  threats: string[];
}

const API_KEY = import.meta.env.VITE_SAFE_BROWSING_API_KEY;
const ENDPOINT = 'https://safebrowsing.googleapis.com/v4/threatMatches:find';

export async function checkUrlSafety(url: string): Promise<SafeBrowsingResult> {
  if (!API_KEY) {
    return { safe: true, threats: [] }; // No key = skip check
  }

  try {
    const body = {
      client: { clientId: 'nada-shield', clientVersion: '2.0.0' },
      threatInfo: {
        threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
        platformTypes: ['ANY_PLATFORM'],
        threatEntryTypes: ['URL'],
        threatEntries: [{ url }],
      },
    };

    const res = await fetch(`${ENDPOINT}?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) return { safe: true, threats: [] };

    const data = await res.json();
    const matches = data.matches ?? [];

    if (matches.length > 0) {
      const threats = matches.map((m: { threatType: string }) => m.threatType);
      return { safe: false, threats };
    }

    return { safe: true, threats: [] };
  } catch {
    return { safe: true, threats: [] }; // Fail open — don't block on network errors
  }
}

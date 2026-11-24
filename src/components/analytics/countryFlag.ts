/**
 * Flag emoji for a country NAME as Google Analytics reports it ("Malaysia",
 * "United States"). The name -> ISO code table is built once from the
 * browser's own Intl.DisplayNames (English), plus a few GA spellings that
 * differ. Returns '' when the country is unknown or Intl is unavailable.
 */

const ALIASES: Record<string, string> = {
  'united states of america': 'US',
  usa: 'US',
  'united kingdom of great britain and northern ireland': 'GB',
  uk: 'GB',
  russia: 'RU',
  'south korea': 'KR',
  'north korea': 'KP',
  turkey: 'TR',
  türkiye: 'TR',
  czechia: 'CZ',
  'czech republic': 'CZ',
  vietnam: 'VN',
  'hong kong': 'HK',
  macao: 'MO',
  macau: 'MO',
  taiwan: 'TW',
  'ivory coast': 'CI',
  "côte d'ivoire": 'CI',
  'myanmar (burma)': 'MM',
  'congo - kinshasa': 'CD',
  'congo - brazzaville': 'CG',
  'palestinian territories': 'PS',
  palestine: 'PS',
  'bosnia & herzegovina': 'BA',
  'bosnia and herzegovina': 'BA',
  'trinidad & tobago': 'TT',
  'antigua & barbuda': 'AG',
  'st. lucia': 'LC',
  eswatini: 'SZ',
  'north macedonia': 'MK',
};

let table: Map<string, string> | null = null;

function buildTable(): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const names = new Intl.DisplayNames(['en'], { type: 'region' });
    const A = 'A'.charCodeAt(0);
    for (let i = 0; i < 26; i++) {
      for (let j = 0; j < 26; j++) {
        const code = String.fromCharCode(A + i, A + j);
        let name: string | undefined;
        try {
          name = names.of(code);
        } catch {
          name = undefined;
        }
        if (name && name !== code) {
          const key = name.toLowerCase();
          if (!map.has(key)) map.set(key, code);
        }
      }
    }
  } catch {
    /* Intl.DisplayNames unavailable: aliases only */
  }
  for (const [name, code] of Object.entries(ALIASES)) map.set(name, code);
  return map;
}

/** ISO 3166-1 alpha-2 code for a country name, or null. */
export function countryCode(name: string): string | null {
  if (!name) return null;
  if (!table) table = buildTable();
  return table.get(name.trim().toLowerCase()) ?? null;
}

/** "Malaysia" -> "🇲🇾" ('' when unknown, e.g. "(not set)"). */
export function countryFlag(name: string): string {
  const code = countryCode(name);
  if (!code || !/^[A-Z]{2}$/.test(code)) return '';
  const base = 0x1f1e6 - 'A'.charCodeAt(0);
  return String.fromCodePoint(base + code.charCodeAt(0), base + code.charCodeAt(1));
}

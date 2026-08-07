// =============================================================================
// Local Scam Pattern Detection — Regex-based
// 25+ patterns covering financial fraud, romance scams, impersonation
// =============================================================================

interface PatternMatch {
  category: string;
  pattern: string;
  weight: number;
}

interface LocalScanResult {
  riskScore: number;
  tactics: string[];
  matches: PatternMatch[];
}

interface PatternDef {
  regex: RegExp;
  category: string;
  weight: number;
  /**
   * When true, weight scales with how many distinct times the pattern
   * matches in the text (capped by repeatCap), instead of a flat one-time
   * hit. A single insult in an otherwise normal message is not harassment;
   * five of them in a row is a real pattern of abuse and should score like
   * one — this is what makes that distinction instead of collapsing both
   * cases to the same fixed weight.
   */
  repeatable?: boolean;
  repeatCap?: number;
}

const PATTERNS: PatternDef[] = [
  // Financial fraud
  { regex: /transfiere?\s*(a|al|ahora|ya|urgente)/i, category: 'Transferencia urgente', weight: 20 },
  { regex: /env[ií]\w*\s*(dinero|plata|pago|transferencia|lana)/i, category: 'Solicitud de dinero', weight: 25 },
  { regex: /(dinero|plata|lana|guita)\s+(necesit|urgente|env[ií]|mand[aá]|pas[aá])/i, category: 'Solicitud de dinero', weight: 25 },
  { regex: /(pas[aá]\w*|mand[aá]\w*|d[aá]\w*)\s+(la\s+)?(plata|lana|guita|dinero)/i, category: 'Solicitud de dinero', weight: 25 },
  { regex: /tarjeta\s*(de\s*cr[eé]dito|d[eé]bito|regalo)/i, category: 'Solicitud de tarjeta', weight: 15 },
  { regex: /n[uú]mero\s*de\s*(cuenta|tarjeta|clave)/i, category: 'Phishing datos bancarios', weight: 25 },
  { regex: /bitcoin|crypto|criptomoneda|wallet/i, category: 'Estafa crypto', weight: 15 },
  { regex: /inversi[oó]n\s*(segura|garantizada|100%)/i, category: 'Inversion fraudulenta', weight: 20 },

  // Urgency & pressure
  { regex: /(urgente|inmediatamente|ahora\s*mismo|[uú]ltima\s*oportunidad)/i, category: 'Presion de urgencia', weight: 12 },
  { regex: /(solo\s*hoy|expira\s*(hoy|en\s*\d)|quedan\s*\d+\s*horas)/i, category: 'Tiempo limitado falso', weight: 15 },
  { regex: /(no\s*le\s*digas|no\s*cuentes|secreto|entre\s*nosotros)/i, category: 'Aislamiento', weight: 18 },

  // Impersonation
  { regex: /(banco|polic[ií]a|gobierno|fiscal[ií]a|hacienda)\s*(te\s*|le\s*)?(contacta|llama|informa)/i, category: 'Suplantacion de entidad', weight: 22 },
  { regex: /soporte\s*t[eé]cnico|microsoft|apple\s*support/i, category: 'Soporte tecnico falso', weight: 20 },
  { regex: /herencia|loteria|premio|sorteo|ganador/i, category: 'Premio falso', weight: 18 },

  // Romance scam
  { regex: /(te\s*amo|mi\s*amor|mi\s*vida).*(dinero|ayuda\s*econ[oó]mica|pr[eé]stamo)/i, category: 'Romance + dinero', weight: 30 },
  { regex: /estoy\s*(en\s*el\s*)?(hospital|accidente|emergencia).*(dinero|enviar|ayuda)/i, category: 'Emergencia falsa', weight: 25 },
  { regex: /(militar|soldado|plataforma\s*petrol[ií]fera|barco).*(no\s*puedo\s*acceder|bloqueado)/i, category: 'Romance military scam', weight: 22 },
  { regex: /\bvisa\b|pasaporte.*pagar|pagar.*\bvisa\b|boleto\s*de\s*avi[oó]n/i, category: 'Estafa de viaje romantico', weight: 20 },

  // Suspicious URLs
  { regex: /bit\.ly|tinyurl|acortar|haz\s*clic\s*aqu[ií]/i, category: 'URL acortada sospechosa', weight: 10 },
  { regex: /\.(ru|cn|tk|xyz|top|buzz)\/?/i, category: 'Dominio sospechoso', weight: 12 },

  // Coercion & threats
  { regex: /(publicar[eé]|difundir[eé]|enviar[eé]).*(fotos|v[ií]deo|[ií]ntim)/i, category: 'Sextorsion', weight: 30 },
  { regex: /(demanda|denuncia|c[aá]rcel|preso).*(no\s*pag|si\s*no)/i, category: 'Amenaza legal falsa', weight: 22 },
  // Conditional threat generalized beyond legal/sextortion phrasing — the
  // pay-or-else structure itself is the tactic, regardless of what follows.
  { regex: /si\s*no\s*(pagas?|colaboras?|env[ií]as?|deposit[aá]s?|obedeces?)/i, category: 'Amenaza condicional (paga o si no)', weight: 25 },
  { regex: /(te\s*vas?\s*a\s*arrepentir|te\s*va\s*a\s*pesar|vas\s*a\s*pagar\s*por\s*esto|esto\s*no\s*se\s*va\s*a\s*quedar\s*as[ií]|[uú]ltima\s*advertencia|atente\s*a\s*las\s*consecuencias)/i, category: 'Amenaza / coaccion', weight: 22 },
  { regex: /(sabemos\s*d[oó]nde\s*vives|conocemos\s*tu\s*direcci[oó]n|algo\s*(le|te)\s*va\s*a\s*pasar|tu\s*familia\s*corre\s*peligro)/i, category: 'Amenaza a la seguridad personal', weight: 30 },

  // Bullying / harassment — this app's own vision doc calls out acoso, not
  // just financial fraud, and a message can be purely abusive with zero
  // scam/money signals (a real example: a string of insults and "vete a la
  // mierda" scored 0/100 before this, because nothing else in it looked like
  // fraud). `repeatable` is what makes this work: one insult in an otherwise
  // normal message is not harassment and must stay low, but five insults in
  // a row is unambiguous, so the weight scales with how many distinct hits
  // land instead of being flat either way.
  {
    regex: /\b(idiota|imb[eé]cil|est[uú]pid[oa]|maldit[oa]|desgraciad[oa]|infeliz|in[uú]til|basura|perra|cerda|zorra|puta|fea|asquerosa|mal\s*educad[oa])\b/i,
    category: 'Lenguaje agresivo u ofensivo',
    weight: 12,
    repeatable: true,
    repeatCap: 4,
  },
  // Severe: explicit rejection/incitement phrasing, not just name-calling —
  // weighted and capped separately so it does not get diluted by averaging
  // against the milder bucket above.
  {
    regex: /(p[uú]drete|vete\s*a\s*la\s*mierda|nadie\s*te\s*quiere|ojal[aá]\s*te\s*mueras|das\s*asco|das\s*pena|no\s*vales\s*nada)/i,
    category: 'Acoso / hostigamiento severo',
    weight: 20,
    repeatable: true,
    repeatCap: 3,
  },

  // Data harvesting
  { regex: /verificar?\s*(tu\s*)?(identidad|cuenta|datos)/i, category: 'Phishing de verificacion', weight: 15 },
  { regex: /contrase[nñ]a|password|clave\s*de\s*acceso|\bpin\b/i, category: 'Solicitud de credenciales', weight: 20 },
  { regex: /selfie\s*con\s*(tu\s*)?(identificaci[oó]n|DNI|INE|pasaporte)/i, category: 'Robo de identidad', weight: 25 },

  // Employment scam
  { regex: /(trabaj[oa]|empleo).*(desde\s*casa|f[aá]cil|sin\s*experiencia).*(ganar|dolar|euro|\$)/i, category: 'Empleo falso', weight: 18 },
  { regex: /comisi[oó]n\s*(por\s*)?(adelantado|antes)/i, category: 'Pago anticipado fraude', weight: 20 },
];

/** Count of distinct, non-overlapping matches for a pattern in the text. */
function countMatches(regex: RegExp, text: string): number {
  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
  const global = new RegExp(regex.source, flags);
  return (text.match(global) ?? []).length;
}

export function scanLocalPatterns(text: string): LocalScanResult {
  const matches: PatternMatch[] = [];
  let totalWeight = 0;

  for (const { regex, category, weight, repeatable, repeatCap } of PATTERNS) {
    if (repeatable) {
      const count = countMatches(regex, text);
      if (count === 0) continue;
      const effectiveCount = Math.min(count, repeatCap ?? count);
      const matchWeight = weight * effectiveCount;
      matches.push({ category, pattern: regex.source, weight: matchWeight });
      totalWeight += matchWeight;
    } else if (regex.test(text)) {
      matches.push({ category, pattern: regex.source, weight });
      totalWeight += weight;
    }
  }

  // Normalize to 0-100 scale (cap at 3 patterns = high risk)
  const riskScore = Math.min(100, Math.round(totalWeight * 1.2));
  const tactics = matches.map((m) => m.category);

  return { riskScore, tactics, matches };
}

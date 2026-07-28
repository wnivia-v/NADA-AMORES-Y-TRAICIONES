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

const PATTERNS: { regex: RegExp; category: string; weight: number }[] = [
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

  // Data harvesting
  { regex: /verificar?\s*(tu\s*)?(identidad|cuenta|datos)/i, category: 'Phishing de verificacion', weight: 15 },
  { regex: /contrase[nñ]a|password|clave\s*de\s*acceso|\bpin\b/i, category: 'Solicitud de credenciales', weight: 20 },
  { regex: /selfie\s*con\s*(tu\s*)?(identificaci[oó]n|DNI|INE|pasaporte)/i, category: 'Robo de identidad', weight: 25 },

  // Employment scam
  { regex: /(trabaj[oa]|empleo).*(desde\s*casa|f[aá]cil|sin\s*experiencia).*(ganar|dolar|euro|\$)/i, category: 'Empleo falso', weight: 18 },
  { regex: /comisi[oó]n\s*(por\s*)?(adelantado|antes)/i, category: 'Pago anticipado fraude', weight: 20 },
];

export function scanLocalPatterns(text: string): LocalScanResult {
  const matches: PatternMatch[] = [];
  let totalWeight = 0;

  for (const { regex, category, weight } of PATTERNS) {
    if (regex.test(text)) {
      matches.push({ category, pattern: regex.source, weight });
      totalWeight += weight;
    }
  }

  // Normalize to 0-100 scale (cap at 3 patterns = high risk)
  const riskScore = Math.min(100, Math.round(totalWeight * 1.2));
  const tactics = matches.map((m) => m.category);

  return { riskScore, tactics, matches };
}

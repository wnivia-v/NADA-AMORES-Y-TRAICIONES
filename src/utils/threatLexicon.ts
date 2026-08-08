// =============================================================================
// Threat lexicon — multilingual, categorised, combination-aware
//
// This is the detection layer that always runs: no API key, no network, no
// model download. That matters more than it sounds, because with no cloud
// provider configured it is the ONLY layer with an opinion — the on-device
// classifier declines whenever it is unsure, and a declined verdict plus an
// empty pattern list is what produced real "0/100, no threats found" results
// on a virtual-kidnapping call and on a police-impersonation extortion.
//
// Two design choices carry most of the accuracy:
//
// 1. CATEGORIES, NOT KEYWORDS. Scams have structure. "banco", "urgente" and
//    "no cuelgue" are individually innocent; together they are a vishing
//    script. Entries are tagged by category so COMBOS below can score that
//    structure, which is what separates a real attack from someone mentioning
//    their bank.
//
// 2. NOTHING SINGLE-WORD FIRES AN ALERT ALONE. Weights are tuned so one
//    isolated signal lands under the SOSPECHOSO threshold. A tool that cries
//    wolf at "voy a tu casa" trains its user to ignore it, and an ignored
//    alert protects nobody.
//
// All matching happens on normalised text (accents stripped, lowercased) —
// see normalizeForMatching. Patterns are written accordingly and stay loose
// about spelling on purpose: these messages arrive full of typos, and OCR and
// speech-to-text add their own.
// =============================================================================

export type ThreatCategory =
  | 'fraude-financiero'
  | 'canal-pago-irrastreable'
  | 'phishing-credenciales'
  | 'suplantacion-autoridad'
  | 'suplantacion-entidad'
  | 'acusacion-falsa'
  | 'extorsion'
  | 'sextorsion'
  | 'secuestro-virtual'
  | 'estafa-romantica'
  | 'amenaza-violencia'
  | 'acoso-insulto'
  | 'acoso-severo'
  | 'induccion-autolesion'
  | 'aislamiento-manipulacion'
  | 'urgencia-presion'
  | 'retencion-llamada'
  | 'empleo-inversion-falsa'
  | 'enlace-sospechoso';

/** Languages the lexicon carries entries for. Extend by tagging new entries. */
export type LexiconLang = 'es' | 'en' | 'pt';

export interface LexiconEntry {
  id: string;
  category: ThreatCategory;
  /** Contribution to the raw score when matched. */
  weight: number;
  langs: readonly LexiconLang[];
  regex: RegExp;
  /** Scale the weight by how many distinct times it matches (abuse escalates). */
  repeatable?: boolean;
  repeatCap?: number;
  /** Human-readable name shown to the user. */
  label: string;
}

const E = (e: LexiconEntry) => e;

export const LEXICON: readonly LexiconEntry[] = [
  // ── Financial fraud ────────────────────────────────────────────────────────
  E({
    id: 'fin-transfer-urgent', category: 'fraude-financiero', weight: 20, langs: ['es'],
    label: 'Transferencia urgente',
    regex: /transfiere?\s*(a|al|ahora|ya|urgente)|hace?\s*(la\s*)?transferencia/,
  }),
  E({
    id: 'fin-send-money', category: 'fraude-financiero', weight: 25, langs: ['es'],
    label: 'Solicitud de dinero',
    regex: /env[ií]\w*\s*(dinero|plata|pago|transferencia|lana)|(dinero|plata|lana|guita)\s+(necesit|urgente|env[ií]|mand[aá]|pas[aá])|(pas[aá]\w*|mand[aá]\w*|d[aá]\w*)\s+(la\s+)?(plata|lana|guita|dinero)/,
  }),
  E({
    id: 'fin-send-money-en', category: 'fraude-financiero', weight: 25, langs: ['en'],
    label: 'Money request',
    regex: /\b(send|wire|transfer)\s+(me\s+)?(the\s+)?(money|cash|funds|payment)\b/,
  }),
  E({
    id: 'fin-send-money-pt', category: 'fraude-financiero', weight: 25, langs: ['pt'],
    label: 'Pedido de dinheiro',
    regex: /\b(envi[ae]|manda|transfere?)\s+(o\s+)?(dinheiro|pagamento|pix)\b/,
  }),
  E({
    id: 'fin-card', category: 'fraude-financiero', weight: 15, langs: ['es', 'en'],
    label: 'Solicitud de tarjeta',
    regex: /tarjeta\s*(de\s*)?(cr[eé]dito|d[eé]bito|regalo)|gift\s*card/,
  }),
  E({
    id: 'fin-crypto', category: 'fraude-financiero', weight: 15, langs: ['es', 'en', 'pt'],
    label: 'Estafa crypto',
    regex: /\b(bitcoin|crypto|criptomoneda|usdt|binance|wallet)\b/,
  }),

  // ── Untraceable payment venues ─────────────────────────────────────────────
  // The defining logistics of a scam: money that cannot be reversed. Alone it
  // is just a shop; combined with pressure it is the whole game.
  E({
    id: 'pay-venue', category: 'canal-pago-irrastreable', weight: 18, langs: ['es', 'en', 'pt'],
    label: 'Canal de pago irrastreable',
    regex: /\b(banco\s+azteca|western\s*union|moneygram|oxxo|deposito\s+en\s+efectivo|giro\s+postal|tarjeta\s+de\s+regalo|paysafe|recarga\s+de\s+saldo)\b/,
  }),
  E({
    id: 'pay-go-to-bank', category: 'canal-pago-irrastreable', weight: 20, langs: ['es'],
    label: 'Instruccion de ir a pagar',
    regex: /(vaya|anda|and[aá]|ve|dirijase|dir[ií]jase|acercate|ac[eé]rcate)\s+(al?\s+)?(banco|cajero|oxxo|farmacia|tienda)/,
  }),

  // ── Keeping the victim on the line ─────────────────────────────────────────
  // Near-universal in phone scams and almost absent from honest calls: it
  // exists to stop the victim from checking with anyone.
  E({
    id: 'hold-line', category: 'retencion-llamada', weight: 26, langs: ['es'],
    label: 'Te retienen en la llamada',
    regex: /no\s+(me\s+)?(cuelgue|cuelgues|corte|cortes)|no\s+(cierre|cierres)\s+la\s+llamada|(quedese|qu[eé]dese|quedate|qu[eé]date)\s+en\s+(la\s+)?l[ií]nea|sigue\s+en\s+(la\s+)?l[ií]nea|no\s+apague\s+el\s+(telefono|celular)/,
  }),
  E({
    id: 'hold-line-en', category: 'retencion-llamada', weight: 26, langs: ['en'],
    label: 'Told not to hang up',
    regex: /\b(do\s*n[o']?t|never)\s+(hang\s*up|disconnect|end\s+the\s+call)|stay\s+on\s+the\s+line\b/,
  }),

  // ── Virtual kidnapping ─────────────────────────────────────────────────────
  E({
    id: 'kidnap', category: 'secuestro-virtual', weight: 38, langs: ['es'],
    label: 'Secuestro virtual',
    regex: /(tengo|tenemos)\s+a\s+(tu|su)\s+(hij[oa]|niñ[oa]|nin[oa]|herman[oa]|madre|padre|mam[aá]|pap[aá]|espos[oa]|muchach[oa])|(secuestr\w+)|(entregar|devolver)\s+(a\s+)?(su|mi|tu)\s+(hij[oa]|muchach[oa]|niñ[oa]|nin[oa])|est[aá]\s+en\s+nuestro\s+poder/,
  }),
  E({
    id: 'kidnap-en', category: 'secuestro-virtual', weight: 38, langs: ['en'],
    label: 'Virtual kidnapping',
    regex: /\bwe\s+(have|got)\s+your\s+(son|daughter|child|kid|mother|father|wife|husband)\b|\bkidnapp?ed\b/,
  }),

  // ── Phishing / credentials ─────────────────────────────────────────────────
  E({
    id: 'phish-bank-data', category: 'phishing-credenciales', weight: 25, langs: ['es'],
    label: 'Phishing de datos bancarios',
    regex: /n[uú]mero\s*de\s*(cuenta|tarjeta|clave)|clave\s+(de\s+)?(acceso|seguridad)|c[oó]digo\s+de\s+(verificaci[oó]n|seguridad|un\s+solo\s+uso)/,
  }),
  E({
    id: 'phish-credentials', category: 'phishing-credenciales', weight: 20, langs: ['es', 'en', 'pt'],
    label: 'Solicitud de credenciales',
    regex: /\b(contrase[nñ]a|password|senha|\bpin\b|\botp\b|token)\b/,
  }),
  E({
    id: 'phish-verify', category: 'phishing-credenciales', weight: 15, langs: ['es', 'en'],
    label: 'Phishing de verificacion',
    regex: /verificar?\s*(tu\s*|su\s*)?(identidad|cuenta|datos)|verify\s+your\s+(account|identity)/,
  }),
  E({
    id: 'phish-selfie-id', category: 'phishing-credenciales', weight: 25, langs: ['es'],
    label: 'Robo de identidad',
    regex: /selfie\s*con\s*(tu\s*|su\s*)?(identificaci[oó]n|dni|ine|pasaporte|cedula|c[eé]dula)/,
  }),

  // ── Authority / entity impersonation ───────────────────────────────────────
  E({
    id: 'imp-authority', category: 'suplantacion-autoridad', weight: 26, langs: ['es'],
    label: 'Suplantacion de autoridad',
    regex: /\b(comisari[oa]|comi?ser[ií]a|comisar[ií]a|subcomisario|sargento|oficial\s+de\s+polic[ií]a|agente\s+(judicial|fiscal)|juzgado|ministerio\s+publico|inspector\s+de\s+(hacienda|impuestos))\b/,
  }),
  E({
    id: 'imp-entity', category: 'suplantacion-entidad', weight: 22, langs: ['es'],
    label: 'Suplantacion de entidad',
    regex: /(banco|polic[ií]a|gobierno|fiscal[ií]a|hacienda)\s*(te\s*|le\s*)?(contacta|llama|informa)/,
  }),
  E({
    id: 'imp-tech-support', category: 'suplantacion-entidad', weight: 20, langs: ['es', 'en'],
    label: 'Soporte tecnico falso',
    regex: /soporte\s*t[eé]cnico|soporte\s*tecnico|microsoft|apple\s*support|tech\s+support/,
  }),
  E({
    id: 'imp-authority-en', category: 'suplantacion-autoridad', weight: 26, langs: ['en'],
    label: 'Authority impersonation',
    regex: /\b(this\s+is\s+)?(officer|detective|sergeant|irs|social\s+security\s+administration)\b/,
  }),

  // ── False accusation / legal threat ────────────────────────────────────────
  E({
    id: 'acc-case-opened', category: 'acusacion-falsa', weight: 28, langs: ['es'],
    label: 'Acusacion judicial falsa',
    regex: /(se\s+le\s+)?(abri[oó]|abrio|inici[oó]|iniciado|existe|tiene)\s+(una\s+)?(causa|denuncia|investigaci[oó]n|expediente|proceso)/,
  }),
  E({
    id: 'acc-serious-crime', category: 'acusacion-falsa', weight: 28, langs: ['es', 'en', 'pt'],
    label: 'Acusacion de delito grave',
    regex: /\b(pedofilia|pornografia\s+infantil|abuso\s+de\s+menores|lavado\s+de\s+(activos|dinero)|narcotrafico|trata\s+de\s+personas|money\s+laundering)\b/,
  }),
  E({
    id: 'acc-arrest', category: 'acusacion-falsa', weight: 28, langs: ['es'],
    label: 'Amenaza de detencion',
    regex: /orden\s+de\s+(captura|detenci[oó]n|detencion|allanamiento|arresto)/,
  }),
  E({
    id: 'acc-legal-threat', category: 'extorsion', weight: 22, langs: ['es'],
    label: 'Amenaza legal falsa',
    regex: /(demanda|denuncia|c[aá]rcel|carcel|preso)\s*.{0,30}?(no\s*pag|si\s*no)/,
  }),

  // ── Extortion / coercion ───────────────────────────────────────────────────
  E({
    id: 'ext-conditional', category: 'extorsion', weight: 25, langs: ['es'],
    label: 'Amenaza condicional (paga o si no)',
    regex: /si\s*no\s*(pagas?|paga|colaboras?|env[ií]as?|deposit[aá]s?|obedeces?)|si\s*(nos\s*|me\s*)?(blo(k|qu)e[ae]|blo(k|qu)eas|denuncias|cortas|cuelgas)/,
  }),
  E({
    id: 'ext-intimidation', category: 'extorsion', weight: 22, langs: ['es'],
    label: 'Amenaza / coaccion',
    regex: /(te\s*vas?\s*a\s*arrepentir|te\s*va\s*a\s*pesar|vas\s*a\s*pagar\s*por\s*esto|esto\s*no\s*se\s*va\s*a\s*quedar\s*as[ií]|[uú]ltima\s*advertencia|ultima\s*advertencia|atente\s*a\s*las\s*consecuencias)/,
  }),
  E({
    id: 'ext-sextortion', category: 'sextorsion', weight: 32, langs: ['es'],
    label: 'Sextorsion',
    regex: /(publicar[eé]|publicare|difundir[eé]|difundire|enviar[eé]|enviare|mandar[eé]|subir[eé])\s*.{0,40}?(fotos|videos?|v[ií]deos?|[ií]ntim|desnud)/,
  }),
  E({
    id: 'ext-sextortion-en', category: 'sextorsion', weight: 32, langs: ['en'],
    label: 'Sextortion',
    regex: /\b(i|we)\s+(will|'ll)\s+(post|share|send|leak)\s+.{0,30}?(photos?|videos?|nudes?|intimate)\b/,
  }),

  // ── Violence / personal safety ─────────────────────────────────────────────
  E({
    id: 'vio-personal-safety', category: 'amenaza-violencia', weight: 30, langs: ['es'],
    label: 'Amenaza a la seguridad personal',
    regex: /(sabemos\s*d[oó]nde\s*vives|conocemos\s*tu\s*direcci[oó]n|algo\s*(le|te)\s*va\s*a\s*pasar|tu\s*familia\s*corre\s*peligro)/,
  }),
  E({
    id: 'vio-physical-presence', category: 'amenaza-violencia', weight: 32, langs: ['es'],
    label: 'Amenaza de presencia fisica',
    regex: /(estamos|estaremos|vamos|iremos|llegamos|pasamos|nos\s+presentamos)\s+(a|en|por)\s*(su|tu)\s*(domicilio|casa|direcci[oó]n|direccion|trabajo)/,
  }),
  E({
    id: 'vio-death', category: 'amenaza-violencia', weight: 35, langs: ['es'],
    label: 'Amenaza de muerte o violencia',
    regex: /((por|x)\s*eso\s*(las?|los?)\s*matan|te\s*(voy|vamos)\s*a\s*matar|te\s*mato|te\s*van\s*a\s*matar|vas\s*a\s*morir|te\s*hago\s*desaparecer)/,
  }),
  E({
    id: 'vio-death-en', category: 'amenaza-violencia', weight: 35, langs: ['en'],
    label: 'Death threat',
    regex: /\bi(\s+am|'m)?\s+(going\s+to|gonna)\s+(kill|hurt)\s+you\b|\byou(\s+are|'re)\s+(dead|going\s+to\s+die)\b/,
  }),

  // ── Harassment / bullying ──────────────────────────────────────────────────
  E({
    id: 'har-insult', category: 'acoso-insulto', weight: 12, langs: ['es'],
    label: 'Lenguaje agresivo u ofensivo',
    regex: /\b(idiota|imb[eé]cil|imbecil|est[uú]pid[oa]|estupid[oa]|maldit[oa]|desgraciad[oa]|infeliz|in[uú]til|inutil|basura|perra|cerda|zorra|puta|fea|asquerosa|mal\s*educad[oa])\b/,
    repeatable: true, repeatCap: 4,
  }),
  E({
    id: 'har-insult-en', category: 'acoso-insulto', weight: 12, langs: ['en'],
    label: 'Abusive language',
    regex: /\b(idiot|stupid|moron|worthless|pathetic|loser|bitch|whore|ugly|trash)\b/,
    repeatable: true, repeatCap: 4,
  }),
  E({
    id: 'har-severe', category: 'acoso-severo', weight: 20, langs: ['es'],
    label: 'Acoso / hostigamiento severo',
    regex: /(p[uú]drete|pudrete|vete\s*a\s*la\s*mierda|nadie\s*te\s*quiere|das\s*asco|das\s*pena|no\s*vales\s*nada|eres\s*una\s*basura)/,
    repeatable: true, repeatCap: 3,
  }),

  // ── Inducement to self-harm — highest severity in the lexicon ──────────────
  // This is not "insults, but worse". Someone telling a person to end their
  // life is the single most dangerous thing this tool can encounter, and it
  // must clear the alert threshold on its own, without needing corroboration.
  E({
    id: 'self-harm', category: 'induccion-autolesion', weight: 60, langs: ['es'],
    label: 'Induccion al suicidio o autolesion',
    regex: /(m[aá]tate|matate|suicidate|su[ií]cidate|ojal[aá]\s*te\s*mueras|deber[ií]as\s*(morirte|matarte)|el\s*mundo\s*estar[ií]a\s*mejor\s*sin\s*ti|desaparece\s*del\s*mundo|nadie\s*te\s*va\s*a\s*extra[nñ]ar)/,
  }),
  E({
    id: 'self-harm-en', category: 'induccion-autolesion', weight: 60, langs: ['en'],
    label: 'Inducement to self-harm',
    regex: /\b(kill\s+yourself|kys|you\s+should\s+die|go\s+die|nobody\s+would\s+miss\s+you)\b/,
  }),

  // ── Isolation / manipulation ───────────────────────────────────────────────
  E({
    id: 'iso-secrecy', category: 'aislamiento-manipulacion', weight: 20, langs: ['es'],
    label: 'Aislamiento',
    regex: /(no\s*le\s*digas|no\s*cuentes|no\s*avises|es\s*un\s*secreto|entre\s*nosotros|no\s*hables\s*con\s*nadie)/,
  }),
  E({
    id: 'iso-secrecy-en', category: 'aislamiento-manipulacion', weight: 20, langs: ['en'],
    label: 'Isolation',
    regex: /\b(do\s*n[o']?t\s+tell\s+(anyone|anybody)|keep\s+this\s+(a\s+)?secret|between\s+us)\b/,
  }),

  // ── Urgency / pressure ─────────────────────────────────────────────────────
  E({
    id: 'urg-general', category: 'urgencia-presion', weight: 12, langs: ['es', 'en', 'pt'],
    label: 'Presion de urgencia',
    regex: /(urgente|inmediatamente|ahora\s*mismo|[uú]ltima\s*oportunidad|ultima\s*oportunidad|urgent|immediately|right\s+now)/,
  }),
  E({
    id: 'urg-deadline', category: 'urgencia-presion', weight: 15, langs: ['es'],
    label: 'Tiempo limitado falso',
    regex: /(solo\s*hoy|expira\s*(hoy|en\s*\d)|quedan\s*\d+\s*(horas|minutos)|tienes\s*\d+\s*minutos)/,
  }),

  // ── Romance scam ───────────────────────────────────────────────────────────
  E({
    id: 'rom-love-money', category: 'estafa-romantica', weight: 30, langs: ['es'],
    label: 'Romance + dinero',
    regex: /(te\s*amo|mi\s*amor|mi\s*vida|cari[nñ]o).{0,60}?(dinero|ayuda\s*econ[oó]mica|pr[eé]stamo|prestamo|env[ií]a)/,
  }),
  E({
    id: 'rom-emergency', category: 'estafa-romantica', weight: 25, langs: ['es'],
    label: 'Emergencia falsa',
    regex: /estoy\s*(en\s*el\s*)?(hospital|accidente|emergencia).{0,60}?(dinero|enviar|ayuda)/,
  }),
  E({
    id: 'rom-military', category: 'estafa-romantica', weight: 22, langs: ['es'],
    label: 'Romance military scam',
    regex: /(militar|soldado|plataforma\s*petrol[ií]fera|barco).{0,60}?(no\s*puedo\s*acceder|bloqueado)/,
  }),
  E({
    id: 'rom-travel', category: 'estafa-romantica', weight: 20, langs: ['es'],
    label: 'Estafa de viaje romantico',
    regex: /\bvisa\b.{0,40}?pagar|pasaporte.{0,40}?pagar|boleto\s*de\s*avi[oó]n/,
  }),

  // ── Fake prizes / jobs / investments ───────────────────────────────────────
  E({
    id: 'job-prize', category: 'empleo-inversion-falsa', weight: 18, langs: ['es'],
    label: 'Premio falso',
    regex: /\b(herencia|loteria|loter[ií]a|premio|sorteo|ganador)\b/,
  }),
  E({
    id: 'job-fake', category: 'empleo-inversion-falsa', weight: 18, langs: ['es'],
    label: 'Empleo falso',
    regex: /(trabaj[oa]|empleo).{0,50}?(desde\s*casa|f[aá]cil|facil|sin\s*experiencia).{0,50}?(ganar|dolar|d[oó]lar|euro|\$)/,
  }),
  E({
    id: 'job-upfront', category: 'empleo-inversion-falsa', weight: 20, langs: ['es'],
    label: 'Pago anticipado fraude',
    regex: /comisi[oó]n\s*(por\s*)?(adelantado|antes)|pago\s+por\s+adelantado/,
  }),
  E({
    id: 'inv-guaranteed', category: 'empleo-inversion-falsa', weight: 20, langs: ['es'],
    label: 'Inversion fraudulenta',
    regex: /inversi[oó]n\s*(segura|garantizada|100%)|ganancias\s+garantizadas/,
  }),

  // ── Suspicious links ───────────────────────────────────────────────────────
  E({
    id: 'link-shortener', category: 'enlace-sospechoso', weight: 10, langs: ['es', 'en', 'pt'],
    label: 'URL acortada sospechosa',
    regex: /bit\.ly|tinyurl|acortar|haz\s*clic\s*aqu[ií]|click\s+here/,
  }),
  E({
    id: 'link-tld', category: 'enlace-sospechoso', weight: 12, langs: ['es', 'en', 'pt'],
    label: 'Dominio sospechoso',
    regex: /\.(ru|cn|tk|xyz|top|buzz)\//,
  }),
];

// =============================================================================
// Combination rules
//
// Where the real accuracy comes from. A scam is a SHAPE — pressure plus an
// untraceable payment plus isolation — and each part on its own is ordinary
// conversation. Scoring the shape catches scripts no single keyword reveals,
// including ones written in words the lexicon has never seen, and it is what
// keeps individual weights low enough not to false-alarm.
// =============================================================================

export interface ComboRule {
  id: string;
  /** Every category must be present for the bonus to apply. */
  requires: readonly ThreatCategory[];
  bonus: number;
  label: string;
}

export const COMBOS: readonly ComboRule[] = [
  {
    id: 'vishing-script',
    requires: ['canal-pago-irrastreable', 'retencion-llamada'],
    bonus: 35,
    label: 'Guion de estafa telefonica (pago irrastreable + te retienen en la llamada)',
  },
  {
    id: 'kidnap-payment',
    requires: ['secuestro-virtual', 'canal-pago-irrastreable'],
    bonus: 40,
    label: 'Secuestro virtual con exigencia de pago',
  },
  {
    id: 'kidnap-hold',
    requires: ['secuestro-virtual', 'retencion-llamada'],
    bonus: 35,
    label: 'Secuestro virtual: te impiden cortar y verificar',
  },
  {
    id: 'authority-extortion',
    requires: ['suplantacion-autoridad', 'acusacion-falsa'],
    bonus: 30,
    label: 'Extorsion con suplantacion policial',
  },
  {
    id: 'authority-payment',
    requires: ['suplantacion-autoridad', 'canal-pago-irrastreable'],
    bonus: 30,
    label: 'Falsa autoridad exigiendo un pago',
  },
  {
    id: 'urgent-untraceable',
    requires: ['urgencia-presion', 'canal-pago-irrastreable'],
    bonus: 25,
    label: 'Pago urgente por un canal que no se puede recuperar',
  },
  {
    id: 'isolated-payment',
    requires: ['aislamiento-manipulacion', 'fraude-financiero'],
    bonus: 25,
    label: 'Piden dinero y que no se lo cuentes a nadie',
  },
  {
    id: 'romance-payment',
    requires: ['estafa-romantica', 'canal-pago-irrastreable'],
    bonus: 25,
    label: 'Vinculo afectivo usado para pedir un pago irrastreable',
  },
  {
    id: 'phish-urgency',
    requires: ['phishing-credenciales', 'urgencia-presion'],
    bonus: 22,
    label: 'Piden credenciales con presion de tiempo',
  },
  {
    id: 'harassment-escalation',
    requires: ['acoso-insulto', 'amenaza-violencia'],
    bonus: 25,
    label: 'Acoso que escala a amenaza',
  },
  {
    id: 'threat-for-payment',
    requires: ['extorsion', 'canal-pago-irrastreable'],
    bonus: 30,
    label: 'Amenaza acompanada de exigencia de pago',
  },
];

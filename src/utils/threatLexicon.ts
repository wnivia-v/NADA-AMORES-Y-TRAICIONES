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
//
// ── Sources ──────────────────────────────────────────────────────────────────
//
// Entries tagged INCIBE come from the fraud alerts published by Spain's
// national cybersecurity institute (incibe.es/ciudadania/avisos) and its 017
// helpline case files. Those are documented, dated reports of campaigns that
// actually ran against real people, which beats inventing plausible-sounding
// scam wording: they record the exact hooks used, and several of the families
// below (parcel customs fees, reverse Bizum, remote-access "support", the
// relative-in-trouble script) were completely invisible to this lexicon
// before.
// =============================================================================

export type ThreatCategory =
  | 'fraude-financiero'
  | 'canal-pago-irrastreable'
  | 'phishing-credenciales'
  | 'suplantacion-autoridad'
  | 'suplantacion-entidad'
  | 'suplantacion-familiar'
  | 'acusacion-falsa'
  | 'extorsion'
  | 'sextorsion'
  | 'secuestro-virtual'
  | 'estafa-romantica'
  | 'amenaza-violencia'
  | 'acoso-insulto'
  | 'acoso-severo'
  | 'difusion-datos'
  | 'grooming'
  | 'induccion-autolesion'
  | 'aislamiento-manipulacion'
  | 'urgencia-presion'
  | 'retencion-llamada'
  | 'empleo-inversion-falsa'
  | 'enlace-sospechoso'
  // ── Familias documentadas por INCIBE ──────────────────────────────────────
  // La capa regex fallaba 11 de 11 casos INCIBE del corpus: puntuaban entre 0 y
  // 29 sobre un umbral de 70. El lexico estaba escrito para amenazas entre
  // personas (violencia, acoso, sextorsion) y apenas cubria la suplantacion
  // institucional, que es la mitad del fraude real que se denuncia en España.
  //
  // Este bloque es la UNION de dos trabajos paralelos sobre el mismo material:
  // el de esta rama y el que entro en main por separado. Se conservan los dos
  // enteros — cada categoria cubre un gancho distinto, y descartar cualquiera
  // de las dos listas seria perder deteccion a cambio de nada.
  | 'dominio-senuelo'
  | 'evento-financiero-falso'
  | 'plazo-administrativo'
  | 'contacto-numero-nuevo'
  | 'pago-anticipado'
  | 'cambio-cuenta-pago'
  | 'salida-de-plataforma'
  | 'verificacion-documental'
  // Las que llegaron por main.
  | 'paqueteria-aduana'
  | 'acceso-remoto'
  | 'pago-inverso';

/** Languages the lexicon carries entries for. Extend by tagging new entries. */
export type LexiconLang = 'es' | 'en' | 'pt';

/**
 * Region del hispanohablante, o '*' para lo que vale en todas partes.
 *
 * El español no es uno. "Coger", "plata", "chamba", "guita", "lana" o "pana"
 * significan cosas distintas —o nada— segun donde se lea, y un patron escrito
 * en peninsular aplicado a un mensaje rioplatense es una fuente de falsos
 * positivos y de amenazas no vistas a partes iguales.
 *
 * Casi todo el lexico es '*' a proposito: marcar una entrada con region la hace
 * INVISIBLE fuera de ella, y esconder una amenaza real por haberla etiquetado
 * de mas es peor que un falso positivo. Solo se regionaliza lo que de verdad
 * cambia de sentido al cruzar la frontera.
 */
export type Region = '*' | 'es' | 'mx' | 'ar' | 'co' | 'cl' | 'pe' | 've';

/**
 * Que clase de expresion es.
 *
 * El lexico solo tenia amenazas, y eso es la mitad del problema: sin la otra
 * mitad, el sistema no tiene forma de saber que "te voy a matar, qué tarde
 * llegas" entre amigos no es lo mismo que dicho por un desconocido. Un
 * amortiguador no borra la coincidencia — la explica, y resta.
 */
export type LexiconKind = 'amenaza' | 'modismo' | 'broma';

export interface LexiconEntry {
  id: string;
  category: ThreatCategory;
  /** Contribution to the raw score when matched. */
  weight: number;
  langs: readonly LexiconLang[];
  /** Donde aplica. Ausente = en todas partes. */
  regions?: readonly Region[];
  regex: RegExp;
  /** Scale the weight by how many distinct times it matches (abuse escalates). */
  repeatable?: boolean;
  repeatCap?: number;
  /** Human-readable name shown to the user. */
  label: string;
  /** De donde sale la entrada. Obligatorio en lo derivado de fuente externa. */
  source?: string;
}

/** Fuente de las entradas derivadas de campañas documentadas. */
const SRC_INCIBE = 'INCIBE — avisos de ciudadania (incibe.es/ciudadania/avisos)';

const E = (e: LexiconEntry) => e;

/**
 * Amortiguadores: expresiones que hacen que una coincidencia deje de significar
 * lo que parecia.
 *
 * `reduces` nombra las categorias que desactiva. Un amortiguador NO baja la
 * puntuacion por su cuenta: retira el peso de las coincidencias que explica, y
 * solo esas. Asi "te mato si no traes el pan" pierde la amenaza de violencia
 * sin tocar nada mas de lo que hubiera en el mensaje.
 *
 * ADVERTENCIA DE PROCEDENCIA: a diferencia de las entradas de amenaza, esto no
 * sale de ninguna fuente documentada. INCIBE publica fraudes, no modismos. Son
 * pocos, conservadores y deliberadamente los mas incontrovertibles; cada region
 * necesita revision de alguien que hable asi a diario antes de ampliarla. Un
 * amortiguador de mas es una amenaza real silenciada, que es el peor error que
 * puede cometer este producto.
 */
export interface DampenerEntry {
  id: string;
  regex: RegExp;
  reduces: readonly ThreatCategory[];
  kind: Exclude<LexiconKind, 'amenaza'>;
  regions?: readonly Region[];
  label: string;
}

const D = (d: DampenerEntry) => d;

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
    // La ultima alternativa cubre la peticion con CANTIDAD en vez de con la
    // palabra "dinero": "mandame 300 euros", "que me mandes 500€". Faltaba, y
    // el hueco era grande — pedir una cifra concreta es mas comun que pedir
    // "dinero" a secas, y es justo lo que hace el guion del fraude del hijo.
    //
    // Los verbos van enumerados y NO con \w*: eso excluye la primera persona
    // ("te mando 300 euros", "te devuelvo 20 euros"), que es alguien mandando
    // dinero, no pidiendolo. Y el lookahead final evita que "20 euros" case
    // dentro de "20 europeos" o "3 eurodiputados".
    regex: /env[ií]\w*\s*(dinero|plata|pago|transferencia|lana)|(dinero|plata|lana|guita)\s+(necesit|urgente|env[ií]|mand[aá]|pas[aá])|(pas[aá]\w*|mand[aá]\w*|d[aá]\w*)\s+(la\s+)?(plata|lana|guita|dinero)|(mandame|mandes|manda|enviame|envies|envia|pasame|pases|pasa|ingresame|ingreses|ingresa|transfiereme|transfieras|transfiere)\s+(unos?\s+)?\d{1,6}\s*(€|euros?|eur|dolares|usd|pavos|pesos|soles|lucas)(?![a-z])/,
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

  // ── Relative in trouble / number change (INCIBE) ───────────────────────────
  // "Hola mama, se me ha roto el movil, este es mi nuevo numero." INCIBE has
  // published repeated alerts on this one and it is among the most reported to
  // their 017 helpline. It scored zero here before: no money word, no threat,
  // no urgency marker — just a sentence a real child could plausibly send.
  // What gives it away is the pairing of a claimed family identity with a
  // channel change, which is exactly what a combination rule is for.
  E({
    id: 'fam-new-number', category: 'suplantacion-familiar', weight: 26, langs: ['es'],
    label: 'Supuesto familiar con numero nuevo',
    regex: /(mam[aá]|pap[aá]|madre|padre|hij[oa]|abuel[oa])\b.{0,80}?(este\s+es\s+mi\s+(nuevo\s+)?n[uú]mero|mi\s+(nuevo\s+)?n[uú]mero\s+(es|nuevo)|cambi[eé]\s+de\s+n[uú]mero|tengo\s+n[uú]mero\s+nuevo|guarda\s+este\s+n[uú]mero)/,
  }),
  E({
    id: 'fam-broken-phone', category: 'suplantacion-familiar', weight: 24, langs: ['es'],
    label: 'Excusa del telefono roto',
    // Absorbe lo que cubria `fam-telefono-perdido`, que se elimino por
    // duplicada: el robo del movil. Las dos entradas describian el mismo hecho
    // sin exigir ninguna termino familiar, asi que sobre "se me rompio el movil,
    // te escribo desde el de un amigo" —un mensaje corriente— disparaban las dos
    // y sumaban 46. Una sola entrada, un solo peso.
    regex: /(se\s+me\s+(ha\s+)?(roto|rompio|ca[ií]do|estropeo|perdio)|se\s+(ha\s+)?(roto|estropeado|da[nñ]ado)|perd[ií]|me\s+(han\s+)?robaron?)\s+(el\s+|mi\s+)?(m[oó]vil|movil|tel[eé]fono|telefono|celular)|(m[oó]vil|movil|tel[eé]fono|telefono|celular)\s+(se\s+me\s+)?(rompio|no\s+funciona|est[aá]\s+roto)/,
  }),
  E({
    id: 'fam-new-number-en', category: 'suplantacion-familiar', weight: 26, langs: ['en'],
    label: 'Relative claiming a new number',
    regex: /\b(mom|mum|dad|mother|father)\b.{0,60}?(this\s+is\s+my\s+new\s+number|i\s+(have\s+)?(a\s+)?new\s+number|my\s+phone\s+(broke|is\s+broken))/,
  }),

  // ── Parcel / customs fee (INCIBE) ──────────────────────────────────────────
  // The most-reported smishing family in Spain: a package held at customs, a
  // small fee, a link. The small amount is the point — it is cheap enough that
  // paying feels easier than checking. The "maleta retenida" variant is the
  // same script wrapped around a romance scam.
  E({
    id: 'parcel-customs', category: 'paqueteria-aduana', weight: 24, langs: ['es'],
    label: 'Paquete retenido con tasas por pagar',
    regex: /(paquete|env[ií]o|envio|pedido|maleta|encomienda|equipaje)\s.{0,60}?(retenid|aduana|tasas?\s+de\s+(aduana|env[ií]o|envio)|gastos\s+de\s+(aduana|env[ií]o|envio)|derechos\s+de\s+aduana)|(aduana|aduanas)\s.{0,40}?(pagar|abonar|tasa|coste)/,
  }),
  E({
    id: 'parcel-carrier-issue', category: 'paqueteria-aduana', weight: 20, langs: ['es'],
    label: 'Falsa incidencia de paqueteria',
    regex: /\b(correos|correos\s+express|seur|dhl|ups|fedex|mrw|paqueter[ií]a)\b.{0,70}?(incidencia|no\s+(se\s+ha\s+podido|pudimos|hemos\s+podido)\s+entregar|reprogram\w+\s+(la\s+)?entrega|actualiz\w+\s+(tu\s+|su\s+)?(direcci[oó]n|datos))/,
  }),

  // ── Remote access (INCIBE) ─────────────────────────────────────────────────
  // The endgame of fake tech support and fake bank-security calls: the victim
  // installs remote-control software and the attacker empties the account from
  // the victim's own device, defeating every 2FA the bank has. Legitimate
  // support does use these tools, so alone this stays well under the threshold
  // — it is the pairing with an impersonated entity or with credentials that
  // makes it an attack.
  E({
    id: 'remote-access-tool', category: 'acceso-remoto', weight: 24, langs: ['es', 'en'],
    label: 'Herramienta de acceso remoto',
    regex: /\b(anydesk|teamviewer|ultraviewer|quicksupport|quick\s+support|escritorio\s+remoto|remote\s+desktop|rustdesk)\b/,
  }),
  E({
    id: 'remote-install-app', category: 'acceso-remoto', weight: 22, langs: ['es'],
    label: 'Piden instalar una app para revisar el equipo',
    regex: /(instal[ae]|instalar|descargu?[ae]|descargar|baj[ae]te?)\s.{0,50}?(aplicaci[oó]n|app|programa|software)\s.{0,50}?(para\s+(que\s+)?(pueda|podamos|poder|revisar|solucionar|verificar|desinfectar|proteger)|acceso\s+remoto|control\s+remoto)/,
  }),

  // ── Reverse payment request (INCIBE) ───────────────────────────────────────
  // "Bizum inverso": on second-hand marketplaces the buyer sends a REQUEST for
  // money instead of a payment, and the seller — expecting to be paid —
  // confirms it and pays the thief. Reported by INCIBE across Wallapop,
  // Milanuncios and Vinted.
  E({
    id: 'reverse-payment', category: 'pago-inverso', weight: 26, langs: ['es'],
    label: 'Solicitud de dinero disfrazada de pago',
    regex: /(acepta|acept[aá]|confirma|aprueba|dale)\s.{0,40}?(la\s+)?solicitud\s+(de\s+)?(dinero|bizum|pago|cobro)|(te\s+)?(he\s+)?(enviado|mandado|pasado)\s+(una\s+)?solicitud\s+de\s+(bizum|dinero|pago)|bizum\s+inverso/,
  }),
  E({
    id: 'reverse-refund-excuse', category: 'pago-inverso', weight: 22, langs: ['es'],
    label: 'Excusa de devolucion o error en el pago',
    regex: /(te\s+)?(he\s+|hemos\s+)?(pagado|enviado|transferido|ingresado)\s+(de\s+)?m[aá]s\b.{0,50}?(devuelve|devolver|reintegra|reembolsa)|(por\s+error|me\s+he\s+equivocado|fue\s+un\s+error)\b.{0,50}?(devuelve|devolver|reembolsa|reintegra)/,
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
  // INCIBE's alert feed is dominated by impersonated public bodies: tax
  // agency, social security, traffic authority, the citizen mailbox. Naming
  // one is not suspicious by itself — people do have business with them — so
  // the weight is low and the combination rules carry the verdict.
  E({
    id: 'imp-public-agency', category: 'suplantacion-entidad', weight: 20, langs: ['es'],
    label: 'Suplantacion de organismo publico',
    regex: /\b(agencia\s+tributaria|aeat|seguridad\s+social|tesorer[ií]a\s+general|dgt|direcci[oó]n\s+general\s+de\s+trafico|carpeta\s+ciudadana|sepe|udef|guardia\s+civil|polic[ií]a\s+nacional)\b/,
  }),
  E({
    id: 'imp-fine-refund', category: 'suplantacion-entidad', weight: 22, langs: ['es'],
    label: 'Multa o devolucion falsa',
    regex: /(multa|sanci[oó]n|sancion)\b.{0,50}?(pendiente|impagada|sin\s+abonar|debe\s+abonar|24\s*horas)|tiene\s+(usted\s+)?una\s+(multa|sanci[oó]n|sancion)|(devoluci[oó]n|devolucion|reembolso|abono|ingreso)\s+(de\s+|pendiente\s+de\s+)?\d+[.,]?\d*\s*(euros?|€)/,
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
    // Presente y futuro. La amenaza se dice casi siempre en presente ("o
    // publico tus fotos") porque suena mas inminente, y esa forma no coincidia.
    // El posesivo de segunda persona evita el falso positivo obvio: "publico
    // mis fotos de las vacaciones" no encaja, "publico tus fotos" si.
    regex: /(publico|publicar[eé]?|publicare|difundo|difundir[eé]?|difundire|env[ií]o|enviar[eé]?|enviare|mando|mandar[eé]?|subo|subir[eé]?|filtro|comparto|ense[nñ]o)\s*(las?\s*|los?\s*)?(tus|sus)?\s*(fotos|videos?|v[ií]deos?|im[aá]genes|desnudos?)|(publico|difundo|mando|env[ií]o|subo|filtro|comparto)\s*.{0,30}?(fotos|videos?|v[ií]deos?|im[aá]genes)\s*(tuyas?|suyas?|[ií]ntimas?|privadas?)/,
  }),
  E({
    id: 'ext-sextortion-en', category: 'sextorsion', weight: 32, langs: ['en'],
    label: 'Sextortion',
    regex: /\b(i|we)\s+(will|'ll)\s+(post|share|send|leak)\s+.{0,30}?(photos?|videos?|nudes?|intimate)\b/,
  }),
  // The mass-mailed variant INCIBE keeps re-publishing: a claim of spyware on
  // the victim's device and a recording through their webcam, demanded in
  // Bitcoin within a deadline. There is no recording and no malware — the
  // script is generic and built from old data breaches — but the fear is real,
  // and victims pay. Recognising the claim itself is what lets the tool say
  // "this is a known template" instead of leaving someone to decide alone.
  E({
    id: 'ext-sextortion-malware', category: 'sextorsion', weight: 30, langs: ['es'],
    label: 'Sextorsion con falso software espia',
    regex: /(instal[eé]|instalado|infectad\w+)\s.{0,50}?(software\s+esp[ií]a|spyware|troyano|malware|virus)|(acceso|control)\s+(a\s+)?(tu|su)\s+(webcam|c[aá]mara|dispositivo)|(te\s+)?(he\s+)?grabad\w+\s.{0,40}?(webcam|c[aá]mara|pantalla|mientras)/,
  }),
  E({
    id: 'ext-sextortion-malware-en', category: 'sextorsion', weight: 30, langs: ['en'],
    label: 'Sextortion with fake spyware claim',
    regex: /\b(installed|infected)\s.{0,40}?(spyware|trojan|malware|rat)\b|\b(access|control)\s+(to\s+)?your\s+(webcam|camera|device)\b|\bi\s+recorded\s+you\b/,
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
    regex: /(estoy|estare|estar[eé]|voy|ire|ir[eé]|llego|llegare|llegar[eé]|paso|pasare|pasar[eé]|me\s+presento|aparezco|estamos|estaremos|vamos|iremos|llegamos|pasamos|nos\s+presentamos)\s+(a|en|por)\s*(su|tu)\s*(domicilio|casa|direcci[oó]n|direccion|trabajo|portal|curro)/,
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

  // ── Exposure / doxing (INCIBE cyberbullying taxonomy) ──────────────────────
  // INCIBE lists spreading someone's private material as a distinct form of
  // cyberbullying, separate from insults. It is also the coercion lever in
  // sextortion and in teen harassment, where the threatened audience — the
  // victim's classmates, contacts or parents — is the whole point.
  E({
    id: 'dox-threat', category: 'difusion-datos', weight: 26, langs: ['es'],
    label: 'Amenaza de difundir datos o imagenes',
    regex: /(voy|vamos|te\s+voy|te\s+vamos)\s+a\s+(publicar|difundir|compartir|filtrar|subir|ense[nñ]ar|mostrar)\b.{0,50}?(datos|direcci[oó]n|tel[eé]fono|telefono|fotos|videos?|v[ií]deos?|conversaciones|capturas|informaci[oó]n)|(lo\s+|las\s+|los\s+)?(voy\s+a\s+)?(mandar|enviar|pasar|ense[nñ]ar)\s+a\s+(todos|todo\s+el\s+mundo|tus\s+(amigos|contactos|padres|compa[nñ]eros|seguidores))/,
  }),
  E({
    id: 'dox-threat-en', category: 'difusion-datos', weight: 26, langs: ['en'],
    label: 'Threat to expose private material',
    regex: /\bi(\s+am|'m)?\s+(going\s+to|gonna)\s+(post|share|leak|send)\s+.{0,40}?(to\s+(everyone|your\s+(friends|contacts|parents|followers))|online)\b|\bi\s+will\s+expose\s+you\b/,
  }),

  // ── Grooming (INCIBE) ──────────────────────────────────────────────────────
  // An adult building trust with a minor, then moving to emotional control and
  // sexual coercion. INCIBE documents the early phase as the one that matters:
  // by the time there is a threat, the material already exists. So the probes
  // are recognised — age, whether the child is alone, whether the parents know
  // — at weights far below the threshold, because each is a question a real
  // relative might ask. It is the shape (probe + secrecy, probe + image
  // request) that identifies grooming, and the combination rules score it.
  E({
    id: 'groom-probe', category: 'grooming', weight: 16, langs: ['es'],
    label: 'Sondeo de edad o supervision',
    regex: /(cu[aá]ntos\s+a[nñ]os\s+(tienes|ten[eé]s|tenes)|qu[eé]\s+edad\s+tienes|est[aá]s\s+sol[oa]\s+(en\s+casa|ahora)|est[aá]n\s+(tus\s+)?(padres|pap[aá]s)\s+(en\s+casa|contigo)|te\s+vigilan\s+el\s+(m[oó]vil|movil|tel[eé]fono|telefono))/,
  }),
  E({
    id: 'groom-image-request', category: 'grooming', weight: 30, langs: ['es'],
    label: 'Peticion de imagenes intimas',
    regex: /(m[aá]ndame|mandame|env[ií]ame|enviame|p[aá]same|pasame|quiero\s+ver|ens[eé][nñ]ame|ensename)\b.{0,45}?(foto|fotos|video|v[ií]deo|selfie)\b.{0,35}?(sin\s+ropa|desnud\w*|[ií]ntim\w*|intim\w*|en\s+ropa\s+interior|del\s+cuerpo|en\s+la\s+ducha)|(foto|fotos|video|v[ií]deo)s?\s+(sin\s+ropa|desnud\w+|[ií]ntim\w+)/,
  }),
  E({
    id: 'groom-image-request-en', category: 'grooming', weight: 30, langs: ['en'],
    label: 'Request for intimate images',
    regex: /\b(send|show)\s+(me\s+)?(a\s+|some\s+|your\s+)?(nudes?|naked\s+(pics?|photos?)|pics?\s+of\s+you\s+(naked|without\s+clothes))\b/,
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
  // The single most reliable tell in investment fraud, per INCIBE's case
  // files: the balance on screen grows, and the moment the victim tries to
  // withdraw it, a fee appears. No legitimate platform charges you for the
  // privilege of taking your own money out.
  E({
    id: 'inv-withdrawal-fee', category: 'empleo-inversion-falsa', weight: 26, langs: ['es'],
    label: 'Comision para poder retirar el dinero',
    regex: /(para\s+)?(retirar|sacar|cobrar|liberar)\s.{0,45}?(tienes?|tiene|debes|debe|hay)\s+que\s+(pagar|abonar|depositar|ingresar)|comisi[oó]n\s+(para|antes\s+de)\s+(retirar|el\s+retiro|poder)|(impuesto|certificado)\s+(para|antes\s+de)\s+(retirar|liberar|cobrar)/,
  }),
  // INCIBE: fake jobs offering 100-500 EUR a day for "simple tasks" — liking
  // videos, rating products — that end with the victim depositing money to
  // unlock the next batch of tasks.
  E({
    id: 'job-tasks-likes', category: 'empleo-inversion-falsa', weight: 22, langs: ['es'],
    label: 'Falso empleo de tareas o likes',
    regex: /(dar|poner|hacer)\s+(me\s+)?gusta\w*\b.{0,45}?(pago|pagamos|ganar|cobrar|comisi[oó]n)|(valorar|puntuar|rese[nñ]ar|calificar)\s+(productos|hoteles|videos|v[ií]deos|aplicaciones)|(tareas|misiones)\s+(sencillas|simples|f[aá]ciles|faciles|diarias)\b.{0,45}?(ganar|pago|cobrar|euros?|d[oó]lares?)/,
  }),
  E({
    id: 'job-daily-earnings', category: 'empleo-inversion-falsa', weight: 22, langs: ['es', 'en'],
    label: 'Promesa de ganancia diaria',
    regex: /(gana|ganar|gan[aá]|cobra|cobrar|earn)\s.{0,25}?\d{2,5}\s*(euros?|€|d[oó]lares?|dolares?|usd|\$)?\s*(al|por|cada|a)\s+(d[ií]a|dia|day)|\d{2,5}\s*(euros?|€|\$)\s*(al|por)\s+(d[ií]a|dia)/,
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

  // ── Voice-specific spoken patterns ─────────────────────────────────────────
  // In a phone call or voice note, threats are short, direct and informal.
  // Written-fraud patterns use longer constructions that speech-to-text rarely
  // produces verbatim. These catch what people actually SAY.

  // Verbal data theft — the spoken version of phishing
  E({
    id: 'voice-data-theft', category: 'phishing-credenciales', weight: 22, langs: ['es'],
    label: 'Solicitud verbal de datos personales',
    regex: /(d[aá]me|dame|pas[aá]me|pasame|dict[aá]me|dictame|dime)\s+(tu[s]?\s*)?(datos|dato|n[uú]mero|clave|contrase[nñ]a|c[oó]digo|pin|tarjeta|cuenta|credencial|direcci[oó]n|direccion|cedula|c[eé]dula|curp|rfc)/,
  }),
  E({
    id: 'voice-data-theft-2', category: 'phishing-credenciales', weight: 22, langs: ['es'],
    label: 'Extraccion verbal de informacion sensible',
    regex: /(necesito|ocupo|requiero)\s+(que\s+me\s+)?(di(gas|ctes)|pase[s]?|de[s]?|envie[s]?|mande[s]?)\s+(tu[s]?\s*)?(datos|n[uú]mero|clave|nip|pin|contrase[nñ]a|c[oó]digo|tarjeta)/,
  }),
  E({
    id: 'voice-confirm-code', category: 'phishing-credenciales', weight: 20, langs: ['es'],
    label: 'Solicitud verbal de codigo de verificacion',
    regex: /(d[ií]me|dame|pasame|pas[aá]me|lee?me)\s+(el\s+)?(c[oó]digo|codigo|sms|mensaje|numero)\s+(que\s+te\s+lleg[oó]|que\s+recibiste|de\s+verificaci[oó]n)/,
  }),

  // Verbal extortion — spoken threats for money
  E({
    id: 'voice-extort-pay', category: 'extorsion', weight: 28, langs: ['es'],
    label: 'Exigencia verbal de pago',
    regex: /(paga|pagame|p[aá]game|p[aá]ganos|deposita|deposit[aá]me)\s*.{0,30}?(o\s+(te|le|les|si\s+no)|sino|si\s+no)/,
  }),
  E({
    id: 'voice-extort-consequence', category: 'extorsion', weight: 25, langs: ['es'],
    label: 'Amenaza verbal con consecuencias',
    regex: /(te\s+va\s+a\s+ir\s+mal|vas\s+a\s+sufrir|te\s+vamos\s+a\s+chingar|te\s+vamos\s+a\s+joder|te\s+va\s+a\s+costar\s+caro|la\s+vas\s+a\s+pagar|me\s+las\s+vas\s+a\s+pagar)/,
  }),
  E({
    id: 'voice-we-know-you', category: 'amenaza-violencia', weight: 28, langs: ['es'],
    label: 'Vigilancia e intimidacion verbal',
    regex: /(te\s+estamos\s+vigilando|te\s+tenemos\s+ubicad[oa]|sabemos\s+qui[eé]n\s+eres|sabemos\s+todo\s+de\s+ti|tenemos\s+tus\s+datos|te\s+estoy\s+vigilando|ya\s+te\s+tenemos\s+identificad[oa]|ya\s+sabemos\s+d[oó]nde)/,
  }),
  E({
    id: 'voice-harm-threat', category: 'amenaza-violencia', weight: 30, langs: ['es'],
    label: 'Amenaza directa de daño',
    regex: /(te\s+voy\s+a\s+hacer\s+da[nñ]o|te\s+vamos\s+a\s+hacer\s+da[nñ]o|te\s+va\s+a\s+pasar\s+algo|le\s+va\s+a\s+pasar\s+algo\s+a\s+tu|cuida(te|se)\s+las?\s+espaldas?|te\s+va\s+a\s+doler)/,
  }),

  // Verbal bullying — escalated spoken abuse
  E({
    id: 'voice-bully-worthless', category: 'acoso-severo', weight: 22, langs: ['es'],
    label: 'Humillacion y desprecio verbal',
    regex: /(no\s+sirves\s+para\s+nada|eres\s+patetic[oa]|das\s+lastima|nadie\s+te\s+soporta|todo\s+el\s+mundo\s+te\s+odia|eres\s+lo\s+peor|no\s+mereces\s+vivir|eres\s+un[a]?\s+buena?\s+para\s+nada)/,
    repeatable: true, repeatCap: 3,
  }),
  E({
    id: 'voice-bully-threat', category: 'acoso-severo', weight: 22, langs: ['es'],
    label: 'Acoso con amenaza implicita',
    regex: /(te\s+voy\s+a\s+arruinar\s+la\s+vida|te\s+voy\s+a\s+destruir|te\s+voy\s+a\s+hundir|voy\s+a\s+acabar\s+contigo|voy\s+a\s+hacer\s+tu\s+vida\s+imposible)/,
  }),
  E({
    id: 'voice-bully-expose', category: 'acoso-severo', weight: 22, langs: ['es'],
    label: 'Amenaza de exposicion / humillacion publica',
    regex: /(le\s+voy\s+a\s+(contar|decir|mostrar)\s+a\s+todos?|todo\s+el\s+mundo\s+se\s+va\s+a\s+enterar|lo\s+voy\s+a\s+publicar\s+todo|voy\s+a\s+exhibirte)/,
  }),

  // Spoken fraud demands — how people actually ask for money on the phone
  E({
    id: 'voice-send-now', category: 'fraude-financiero', weight: 22, langs: ['es'],
    label: 'Exigencia inmediata de dinero',
    regex: /(manda(me|le)?|env[ií]a(me|le)?|haz(me)?|depos[ií]ta(me)?)\s+(la\s+)?(lana|feria|varo[s]?|billete[s]?|billullo|baro[s]?)\b/,
  }),
  E({
    id: 'voice-dont-tell-police', category: 'aislamiento-manipulacion', weight: 25, langs: ['es'],
    label: 'Prohibicion de contactar autoridades',
    regex: /(no\s+(llames?|avises?|vayas?|acudas?)\s+(a\s+)?(la\s+)?(polic[ií]a|autoridades|comisari[oa]|comisar[ií]a|ley|ministerio))/,
  }),
  E({
    id: 'voice-obey', category: 'extorsion', weight: 22, langs: ['es'],
    label: 'Exigencia de obediencia',
    regex: /(haz\s+lo\s+que\s+te\s+digo|haz\s+lo\s+que\s+te\s+pido|obedece|obedeceme|has\s+lo\s+que\s+te\s+digo|calladito|calladita|sin\s+preguntas)/,
  }),

  // Spoken kidnapping — informal phone phrasing
  E({
    id: 'voice-kidnap-informal', category: 'secuestro-virtual', weight: 35, langs: ['es'],
    label: 'Secuestro virtual (frases orales)',
    regex: /(aqui\s+tengo\s+a|aqu[ií]\s+tengo\s+a|lo\s+tengo\s+aqui|la\s+tengo\s+aqui|est[aá]\s+conmigo\s+tu|escucha\s+a\s+tu|oye\s+como\s+(llora|grita))\s*(tu\s+)?(hij[oa]|mam[aá]|pap[aá]|herman[oa]|espos[oa]|familia|ni[nñ][oa])/,
  }),

  // ===========================================================================
  // Suplantacion institucional y smishing
  //
  // Derivado de las familias que INCIBE publica en sus avisos de ciudadania:
  // suplantacion de entidades bancarias, Seguridad Social (TGSS), Agencia
  // Tributaria (AEAT), AEMET, DGT y empresas de paqueteria.
  //
  // Ninguna de estas entradas alerta sola, y es intencionado: "Correos" o "mi
  // banco" aparecen en conversaciones normales todos los dias. Lo que delata al
  // fraude es la FORMA — entidad + suceso inventado + prisa + enlace — y eso lo
  // puntuan los COMBOS de mas abajo, no las palabras sueltas.
  // ===========================================================================
  E({
    id: 'inst-entidad-es', category: 'suplantacion-entidad', weight: 10, langs: ['es'],
    label: 'Mensaje en nombre de una entidad o administracion',
    source: SRC_INCIBE,
    regex: /\b(bbva|santander|caixa\s*bank|caixabank|la\s*caixa|kutxa|bankinter|unicaja|sabadell|ing\s*direct|correos|seur|mrw|dhl|dgt|aeat|agencia\s*tributaria|seguridad\s*social|tgss|aemet|ministerio\s*de\s*sanidad|hacienda)\b/,
  }),
  E({
    id: 'inst-evento-financiero', category: 'evento-financiero-falso', weight: 16, langs: ['es'],
    label: 'Cargo o movimiento que no reconoces',
    source: SRC_INCIBE,
    regex: /((cargo|compra|movimiento|adeudo|transferencia)\s+(de\s+|por\s+)?(importe\s+)?[\d.,]+\s*(eur|euros|€)|si\s*no\s*(ha\s*sido\s*usted|reconoce|lo\s*reconoce)|acceso\s*no\s*autorizado|(cargo|compra)\s*(pre-?aprobad|acept)|movimiento\s*sospechoso)/,
  }),
  E({
    id: 'inst-plazo-admin', category: 'plazo-administrativo', weight: 12, langs: ['es'],
    label: 'Plazo administrativo que vence',
    source: SRC_INCIBE,
    regex: /(a\s*partir\s*del?\s*\d|ultimo\s*dia\s*para|antes\s*del?\s*\d{1,2}[/\-\s]|no\s*(podra|podras|puedes|puede)\s*(utilizar|usar|acceder)|requiere\s*renovacion|renovacion\s*obligatoria|pendiente\s*de\s*(pago|regularizar)|sin\s*recargo)/,
  }),
  E({
    id: 'inst-activacion', category: 'phishing-credenciales', weight: 14, langs: ['es'],
    label: 'Te piden activar o verificar en un enlace',
    source: SRC_INCIBE,
    regex: /((activa|active|activar|verifica|verifique|verificar|confirme|confirma|valide|valida|validar)\s*(ahora|aqui|inmediatamente|sus?\s*datos|tu\s*cuenta|su\s*cuenta|tu\s*registro|su\s*registro|tu\s*identidad|su\s*identidad|en\s*el\s*siguiente)|nuevo\s*sistema\s*de\s*seguridad|complete\s*el\s*proceso|tramite\s*de\s*seguridad)/,
  }),

  // ── Dominio señuelo ────────────────────────────────────────────────────────
  // La señal mas solida de toda esta familia, y la que menos depende del idioma:
  // el enlace. Una marca conocida pegada con guion a una palabra de seguridad, o
  // colgada de un TLD barato, no es un dominio corporativo. En los once casos
  // INCIBE del corpus aparece en once.
  E({
    id: 'dom-tld-barato', category: 'dominio-senuelo', weight: 26, langs: ['es', 'en', 'pt'],
    label: 'Enlace en un dominio de los que se usan para fraude',
    source: SRC_INCIBE,
    regex: /https?:\/\/[^\s]*\.(top|xyz|tk|buzz|cn|gq|ml|cf|ga|icu|click|rest|monster|sbs|cfd)\b/,
  }),
  E({
    id: 'dom-marca-senuelo', category: 'dominio-senuelo', weight: 22, langs: ['es', 'en', 'pt'],
    label: 'Enlace que imita el dominio de una entidad',
    source: SRC_INCIBE,
    regex: /https?:\/\/[^\s]*\b(bbva|santander|caixa|kutxa|bankinter|sabadell|unicaja|correos|seur|dgt|aeat|sanidad|hacienda|paypal|amazon|netflix|whatsapp)[-.][^\s]*\.(?!es\/|com\/|es$|com$)[a-z]{2,}/,
  }),

  // ── Familiar en apuros ─────────────────────────────────────────────────────
  // "¿Has recibido un mensaje desde un numero desconocido que dice ser tu hijo?"
  // La estructura documentada: numero nuevo + perdida del telefono + peticion de
  // dinero + prisa. Cada pieza por separado es una conversacion familiar normal.
  E({
    id: 'fam-numero-nuevo', category: 'contacto-numero-nuevo', weight: 18, langs: ['es'],
    label: 'Dice escribirte desde un numero nuevo (sin nombrar familia)',
    source: SRC_INCIBE,
    // EXCLUYE los mensajes con termino familiar, y esa exclusion es el arreglo
    // de un falso positivo real.
    //
    // Esta entrada y `fam-new-number` se escribieron por separado, en dos ramas
    // paralelas, y describen el mismo hecho por caminos distintos: aquella pide
    // familiar + numero nuevo, esta solo el numero nuevo. Al juntarlas, las dos
    // acertaban sobre "Mama, este es mi nuevo numero del trabajo, guardalo" y
    // sumaban 53 puntos a un mensaje perfectamente normal. Exactamente el
    // Problema A, producido por una fusion.
    //
    // Se hacen mutuamente excluyentes: con familia delante manda la otra (mas
    // especifica y con mas peso), sin familia manda esta. No se pierde
    // cobertura —el caso sin familia lo cubre solo esta— y ningun mensaje suma
    // las dos.
    regex: new RegExp(
      '^(?=[\\s\\S]*((este\\s*es\\s*)?mi\\s*(nuevo|otro)\\s*(numero|telefono|movil|celular|whatsapp)'
      + '|cambie\\s*de\\s*(numero|telefono|movil|celular|linea)'
      + '|escribo\\s*desde\\s*otro\\s*(numero|telefono|movil)'
      + '|guarda\\s*este\\s*numero|borra\\s*el\\s*(numero\\s*)?(viejo|anterior)))'
      + '(?![\\s\\S]*\\b(mama|papa|madre|padre|hij[oa]|abuel[oa]|ti[oa]|herman[oa]|nieto|nieta)\\b)',
    ),
  }),

  // ── Pago por adelantado ────────────────────────────────────────────────────
  // La forma que comparten la falsa oferta de empleo, el prestamo preaprobado y
  // el premio con gastos de gestion: para cobrar, primero paga tu.
  E({
    id: 'anticipo-fianza', category: 'pago-anticipado', weight: 24, langs: ['es'],
    label: 'Te piden pagar por adelantado para cobrar despues',
    source: SRC_INCIBE,
    regex: /((fianza|deposito|senal|reserva\s*de\s*plaza|comision\s*de\s*gestion|gastos\s*de\s*(gestion|envio|tramitacion|aduana)|anticipo)[^.]{0,60}(envi|abon|ingres|transferi|pag))|((envi|abon|ingres|transferi|pag)[^.]{0,40}(fianza|deposito|comision\s*de\s*gestion|gastos\s*de\s*(gestion|envio)))|(por\s*adelantado[^.]{0,40}(liberar|desbloquear|recibir|cobrar))|(se\s*(te\s*)?devuelve\s*(el|al)\s*primer\s*dia)/,
  }),
  E({
    id: 'anticipo-preaprobado', category: 'pago-anticipado', weight: 16, langs: ['es'],
    label: 'Prestamo o premio ya concedido que no pediste',
    source: SRC_INCIBE,
    regex: /(prestamo[^.]{0,30}(pre-?aprobad|concedid)|credito\s*pre-?aprobad|ha\s*sido\s*seleccionad|le\s*ha\s*tocado|resultado\s*ganador)/,
  }),

  // ── Fraude del cambio de cuenta ────────────────────────────────────────────
  E({
    id: 'cuenta-cambio', category: 'cambio-cuenta-pago', weight: 26, langs: ['es'],
    label: 'Aviso de cambio de cuenta bancaria para los pagos',
    source: SRC_INCIBE,
    regex: /((hemos\s*)?cambiado\s*(nuestra|de)\s*cuenta\s*(bancaria)?|nueva\s*cuenta\s*bancaria|actualice\s*sus\s*(registros|datos\s*de\s*pago)|los\s*pagos\s*deben\s*realizarse\s*a\s*la\s*nueva|a\s*partir\s*de\s*hoy\s*todos\s*los\s*pagos)/,
  }),

  // ── Verificacion documental ────────────────────────────────────────────────
  E({
    id: 'doc-selfie-dni', category: 'verificacion-documental', weight: 28, langs: ['es'],
    label: 'Te piden foto del DNI o de la tarjeta',
    source: SRC_INCIBE,
    regex: /((selfie|foto|fotografia|imagen)[^.]{0,50}(dni|nie|pasaporte|cedula|ine|carnet|tarjeta)|(dni|pasaporte|cedula|tarjeta)[^.]{0,30}(por\s*ambos\s*lados|ambas\s*caras)|sosteniendo\s*(tu|su)\s*(dni|cedula|pasaporte|ine))/,
  }),

  // ── Estafa romantica: salida de plataforma ─────────────────────────────────
  // INCIBE lo recomienda al reves y por eso sirve como señal: aconseja seguir
  // dentro de la app de contactos y desconfiar de quien empuja a salir de ella.
  // El estafador necesita sacarte fuera, donde no hay moderacion ni denuncias.
  E({
    id: 'rom-salida-plataforma', category: 'salida-de-plataforma', weight: 14, langs: ['es'],
    label: 'Insiste en seguir la conversacion fuera de la aplicacion',
    source: SRC_INCIBE,
    regex: /((sigamos|seguimos|hablamos|continuemos|mejor)\s*(hablando\s*)?(por|en)\s*(whatsapp|telegram|wasap|wasa|hangouts|signal|correo|email)|(pasame|dame|mandame)\s*tu\s*(whatsapp|telegram|numero|correo)|(salgamos|salir)\s*de\s*(aqui|esta\s*app|la\s*aplicacion)|no\s*me\s*gusta\s*esta\s*app)/,
  }),
  E({
    id: 'rom-futuro-idealizado', category: 'estafa-romantica', weight: 10, langs: ['es'],
    label: 'Promesas de futuro muy pronto',
    source: SRC_INCIBE,
    regex: /(nunca\s*(habia\s*)?(senti|conocido)[^.]{0,40}(asi|como\s*tu)|eres\s*(el|la)\s*(amor\s*de\s*mi\s*vida|mujer|hombre)\s*(de\s*mi\s*vida)|casarme\s*contigo|pasar\s*el\s*resto\s*de\s*mi\s*vida|estamos\s*destinados|alma\s*gemela)/,
  }),

  // ── Sextorsion con plazo y criptomoneda ────────────────────────────────────
  // INCIBE describe el guion: acceso falso al dispositivo, plazo de 48-50 horas
  // y pago en bitcoin. Los atacantes no tienen material; el plazo es la palanca.
  E({
    id: 'sex-plazo-horas', category: 'sextorsion', weight: 20, langs: ['es'],
    label: 'Plazo de horas para pagar',
    source: SRC_INCIBE,
    regex: /(tienes?\s*(un\s*plazo\s*de\s*)?\d{1,3}\s*horas|dispones\s*de\s*\d{1,3}\s*horas|en\s*las\s*proximas\s*\d{1,3}\s*horas|plazo\s*de\s*\d{1,3}\s*horas)/,
  }),
  E({
    id: 'sex-acceso-dispositivo', category: 'sextorsion', weight: 22, langs: ['es'],
    label: 'Dice tener acceso a tu dispositivo o camara',
    source: SRC_INCIBE,
    regex: /(he\s*(instalado|infectado)[^.]{0,40}(virus|troyano|software|programa|spyware)|tengo\s*acceso\s*(a\s*)?(tu|su)\s*(dispositivo|ordenador|movil|camara|webcam)|grabado[^.]{0,30}(camara|webcam|pantalla)|controlo\s*(tu|su)\s*(camara|webcam|dispositivo))/,
  }),

  E({
    id: 'empleo-oferta-formal', category: 'empleo-inversion-falsa', weight: 12, langs: ['es'],
    label: 'Oferta de trabajo no solicitada',
    source: SRC_INCIBE,
    regex: /(oferta\s*de\s*(trabajo|empleo)|necesitamos\s*(personal|gente|socorristas|comerciales|repartidores)|buscamos\s*(personal|candidatos)|puesto\s*vacante|contrato\s*inmediato|sueldo\s*de?\s*[\d.,]+\s*(eur|euros|€|\/mes|al\s*mes))/,
  }),
  E({
    id: 'fin-iban-en-mensaje', category: 'fraude-financiero', weight: 10, langs: ['es', 'en', 'pt'],
    label: 'Numero de cuenta dentro del mensaje',
    source: SRC_INCIBE,
    // Peso bajo a proposito: una factura legitima tambien lleva IBAN. Lo que lo
    // convierte en señal es aparecer JUNTO a un aviso de cambio de cuenta, y de
    // eso se encarga el COMBO, no esta entrada.
    regex: /\b[a-z]{2}\d{2}[\s]?(\d{4}[\s]?){4,5}\d{0,4}\b/,
  }),

  E({
    id: 'fin-transfer-account', category: 'fraude-financiero', weight: 24, langs: ['es'],
    label: 'Peticion de transferencia a una cuenta',
    // "transferir" faltaba en español aunque si estaba en el patron portugues,
    // asi que "transfiere 5000 a mi cuenta" puntuaba solo por la urgencia.
    // Exige destino o importe: "te transfiero lo de la cena" no encaja.
    regex: /(transfier\w*|transferi\w*|ingres[ae]\w*|abon[ae]\w*|hazme\s*un\s*(bizum|pago|ingreso)|mand[aá]\w*\s*(un\s*)?bizum|realice\s*(el\s*)?(pago|ingreso))[^.]{0,40}(a\s*(mi|esta|la\s*siguiente|dicha)\s*cuenta|por\s*bizum|a\s*este\s*(numero|iban)|[\d.,]{3,})/,
  }),

  E({
    id: 'vio-beating', category: 'amenaza-violencia', weight: 32, langs: ['es'],
    label: 'Amenaza de agresion fisica',
    // El lexico solo tenia amenazas de muerte. Una paliza anunciada no es un
    // aviso menor — es la amenaza mas frecuente en violencia de pareja, que es
    // justo la mitad del nombre de este producto.
    regex: /te\s*(reviento|parto\s*(la\s*)?(cara|boca|piernas)|rompo\s*(la\s*)?(cara|boca)|muelo\s*a\s*palos|doy\s*una\s*paliza|saco\s*los\s*dientes|abro\s*la\s*cabeza|desfiguro|reviento\s*a\s*(hostias|golpes))|te\s*(voy|vamos)\s*a\s*(reventar|partir|romper|dar\s*una\s*paliza|moler)/,
  }),
  E({
    id: 'vio-know-where', category: 'amenaza-violencia', weight: 30, langs: ['es'],
    label: 'Dice saber donde vives o donde estas',
    regex: /((se|sabe|se\s*muy\s*bien)\s*d[oó]nde\s*(vives|trabajas|estas)|te\s*(tengo|tenemos)\s*localizad|te\s*estoy\s*(viendo|siguiendo)|se\s*por\s*d[oó]nde\s*(pasas|andas))/,
>>>>>>> origin/main
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
<<<<<<< HEAD
  // ── Voice-typical combination shapes ─────────────────────────────────────
  {
    id: 'extortion-violence',
    requires: ['extorsion', 'amenaza-violencia'],
    bonus: 30,
    label: 'Extorsion con amenaza de violencia',
  },
  {
    id: 'bullying-self-harm',
    requires: ['acoso-severo', 'induccion-autolesion'],
    bonus: 30,
    label: 'Acoso severo con induccion a autolesion',
  },
  {
    id: 'data-theft-isolation',
    requires: ['phishing-credenciales', 'aislamiento-manipulacion'],
    bonus: 25,
    label: 'Robo de datos con aislamiento (no se lo digas a nadie)',
  },
  {
    id: 'violence-isolation',
    requires: ['amenaza-violencia', 'aislamiento-manipulacion'],
    bonus: 28,
    label: 'Amenaza de violencia con aislamiento',
  },
  {
    id: 'extortion-data-theft',
    requires: ['extorsion', 'phishing-credenciales'],
    bonus: 25,
    label: 'Extorsion combinada con robo de datos',
  },
  {
    id: 'insult-severe-escalation',
    requires: ['acoso-insulto', 'acoso-severo'],
    bonus: 20,
    label: 'Acoso que escala a hostigamiento severo',
=======

  // ── Formas documentadas por INCIBE ─────────────────────────────────────────
  //
  // UNION de dos trabajos paralelos sobre el mismo material: el de esta rama y
  // el que entro en main por separado. Se conservan los dos porque cubren
  // ganchos distintos, pero conviene saber que hay solapamiento conceptual —
  // "familiar-apuros" y "family-impersonation-money" describen la misma estafa
  // por caminos distintos. Dos reglas que disparan a la vez suman sus dos
  // bonus, asi que esto NO se da por bueno sin medir: bench/measure-regex.ts
  // manda, y lo que importa es que las falsas alarmas sigan en cero.

  {
    id: 'smishing-institucional',
    requires: ['suplantacion-entidad', 'dominio-senuelo'],
    bonus: 34,
    label: 'Mensaje en nombre de una entidad con un enlace que no es suyo',
  },
  {
    id: 'smishing-cargo-falso',
    requires: ['evento-financiero-falso', 'phishing-credenciales'],
    bonus: 30,
    label: 'Cargo inventado que te empuja a verificar en un enlace',
  },
  {
    id: 'smishing-plazo-enlace',
    requires: ['plazo-administrativo', 'dominio-senuelo'],
    bonus: 28,
    label: 'Plazo que vence y un enlace para evitarlo',
  },
  {
    id: 'familiar-apuros',
    requires: ['contacto-numero-nuevo', 'fraude-financiero'],
    bonus: 38,
    label: 'Numero nuevo que dice ser de la familia y pide dinero',
  },
  {
    id: 'familiar-apuros-urgente',
    requires: ['contacto-numero-nuevo', 'urgencia-presion'],
    bonus: 22,
    label: 'Numero nuevo que dice ser de la familia y mete prisa',
  },
  {
    id: 'empleo-con-anticipo',
    requires: ['empleo-inversion-falsa', 'pago-anticipado'],
    bonus: 34,
    label: 'Oferta de trabajo que te pide dinero por adelantado',
  },
  {
    id: 'anticipo-con-urgencia',
    requires: ['pago-anticipado', 'urgencia-presion'],
    bonus: 20,
    label: 'Pago por adelantado con prisa',
  },
  {
    id: 'sextorsion-con-plazo',
    requires: ['sextorsion', 'canal-pago-irrastreable'],
    bonus: 32,
    label: 'Chantaje sexual con pago irrastreable',
  },
  {
    id: 'romance-fuera-de-plataforma',
    requires: ['salida-de-plataforma', 'estafa-romantica'],
    bonus: 22,
    label: 'Vinculo emocional rapido y prisa por salir de la aplicacion',
  },
  {
    id: 'romance-salida-dinero',
    requires: ['salida-de-plataforma', 'fraude-financiero'],
    bonus: 30,
    label: 'Te saca de la aplicacion y te pide dinero',
  },
  {
    id: 'verificacion-con-enlace',
    requires: ['verificacion-documental', 'phishing-credenciales'],
    bonus: 26,
    label: 'Te pide documentos de identidad a traves de un enlace',
  },
  {
    id: 'cambio-cuenta-con-urgencia',
    requires: ['cambio-cuenta-pago', 'urgencia-presion'],
    bonus: 26,
    label: 'Cambio de cuenta bancaria con prisa',
  },
  {
    id: 'cambio-cuenta-con-iban',
    requires: ['cambio-cuenta-pago', 'fraude-financiero'],
    bonus: 30,
    label: 'Aviso de cambio de cuenta con un numero de cuenta nuevo',
  },
  {
    id: 'sextorsion-con-pago',
    requires: ['sextorsion', 'fraude-financiero'],
    bonus: 28,
    label: 'Chantaje sexual con exigencia de pago',
    // La forma definitoria de la sextorsion: la amenaza y el cobro. Solo existia
    // el combo con canal irrastreable (bitcoin, tarjetas regalo), asi que un
    // chantaje cobrado por transferencia corriente se quedaba a tres puntos del
    // umbral. El canal no es lo que define el delito.
  },

  // ── Families documented by INCIBE ──────────────────────────────────────────

  {
    id: 'family-impersonation-money',
    requires: ['suplantacion-familiar', 'fraude-financiero'],
    bonus: 35,
    label: 'Se hace pasar por un familiar para pedirte dinero',
  },
  {
    id: 'family-impersonation-urgency',
    requires: ['suplantacion-familiar', 'urgencia-presion'],
    bonus: 20,
    label: 'Supuesto familiar con numero nuevo y prisa',
  },
  {
    id: 'parcel-fee-link',
    requires: ['paqueteria-aduana', 'enlace-sospechoso'],
    bonus: 25,
    label: 'Falsa incidencia de paqueteria con enlace de pago',
  },
  {
    id: 'parcel-fee-payment',
    requires: ['paqueteria-aduana', 'fraude-financiero'],
    bonus: 25,
    label: 'Te piden pagar tasas por un envio retenido',
  },
  {
    // The full fake-support script: an impersonated bank or brand, then remote
    // control of the victim's own device. Beats two-factor authentication,
    // because the transfer is made from the trusted phone.
    id: 'remote-access-impersonation',
    requires: ['acceso-remoto', 'suplantacion-entidad'],
    bonus: 35,
    label: 'Falso soporte pidiendo acceso remoto a tu dispositivo',
  },
  {
    id: 'remote-access-credentials',
    requires: ['acceso-remoto', 'phishing-credenciales'],
    bonus: 35,
    label: 'Acceso remoto junto con peticion de claves',
  },
  {
    id: 'agency-phishing',
    requires: ['suplantacion-entidad', 'phishing-credenciales'],
    bonus: 28,
    label: 'Suplantan un organismo o empresa para pedirte tus datos',
  },
  {
    id: 'agency-link-urgency',
    requires: ['suplantacion-entidad', 'enlace-sospechoso'],
    bonus: 22,
    label: 'Organismo suplantado con enlace para actuar deprisa',
  },
  {
    id: 'reverse-payment-marketplace',
    requires: ['pago-inverso', 'urgencia-presion'],
    bonus: 22,
    label: 'Solicitud de dinero disfrazada de pago, con prisa',
  },
  {
    id: 'sextortion-payment',
    requires: ['sextorsion', 'fraude-financiero'],
    bonus: 30,
    label: 'Chantaje sexual con exigencia de pago',
  },
  {
    id: 'investment-payment-trap',
    requires: ['empleo-inversion-falsa', 'canal-pago-irrastreable'],
    bonus: 25,
    label: 'Falso empleo o inversion cobrando por un canal irrastreable',
  },
  {
    // Grooming rarely announces itself. What it does is probe, then isolate.
    id: 'grooming-isolation',
    requires: ['grooming', 'aislamiento-manipulacion'],
    bonus: 35,
    label: 'Sondeo a un menor pidiendole que lo mantenga en secreto',
  },
  {
    id: 'grooming-coercion',
    requires: ['grooming', 'sextorsion'],
    bonus: 40,
    label: 'Peticion de imagenes a un menor con chantaje',
  },
  {
    id: 'doxing-harassment',
    requires: ['difusion-datos', 'acoso-insulto'],
    bonus: 25,
    label: 'Acoso con amenaza de exponerte publicamente',
  },
  {
    id: 'doxing-extortion',
    requires: ['difusion-datos', 'extorsion'],
    bonus: 28,
    label: 'Chantaje con difundir material privado',
>>>>>>> origin/main
  },
];


// =============================================================================
// Amortiguadores
//
// Lo que faltaba para que el contexto pueda desmentir a la palabra. Sin esto,
// "te mato, que llegas tardisimo" entre dos amigas puntua igual que una amenaza
// de un desconocido, porque el lexico solo sabia sumar.
//
// PROCEDENCIA: esto NO viene de INCIBE ni de ninguna otra fuente documentada —
// INCIBE publica fraudes, no modismos. Son pocos, conservadores y de los mas
// incontrovertibles que hay. Cada region necesita que los revise alguien que
// hable asi a diario antes de ampliar la lista, porque un amortiguador de mas
// silencia una amenaza real, que es el peor error posible aqui.
// =============================================================================

export const DAMPENERS: readonly DampenerEntry[] = [
  D({
    id: 'damp-hiperbole-cariño', kind: 'modismo',
    label: 'Hiperbole afectiva, no amenaza',
    reduces: ['amenaza-violencia'],
    // "me matas", "te mato" con complemento domestico o afectivo alrededor.
    regex: /((me|te)\s*mat(o|as|a)\s*(de\s*risa|de\s*amor|a\s*disgustos|con\s*lo\s*que\s*dices)|me\s*estas\s*matando\s*(de\s*risa|con)|te\s*mato\s*si\s*no\s*(traes|vienes|me\s*cuentas|me\s*llamas))/,
  }),
  D({
    id: 'damp-broma-explicita', kind: 'broma',
    label: 'Marcado como broma en el propio mensaje',
    reduces: ['amenaza-violencia', 'acoso-insulto'],
    regex: /(es\s*broma|era\s*broma|jaja|jeje|jiji|xd|\blol\b|entre\s*bromas|no\s*va\s*en\s*serio|es\s*coña|es\s*cachondeo)/,
  }),
  D({
    id: 'damp-insulto-complice', kind: 'modismo',
    label: 'Insulto usado como trato de confianza',
    reduces: ['acoso-insulto'],
    regions: ['es'],
    // En peninsular "cabron"/"hijo de puta" funcionan como vocativo de aprecio
    // cuando van con saludo o felicitacion. Fuera de España no se comportan asi,
    // de ahi la marca de region.
    regex: /((que|q)\s*(cabron|crack|maquina|figura|fiera)\b|cabron[a]?\s*(que\s*)?(tal|como\s*estas|cuanto\s*tiempo)|hijo\s*de\s*puta\s*(que\s*)?(crack|grande|maquina))/,
  }),
  D({
    id: 'damp-reenvio-consulta', kind: 'modismo',
    label: 'Reenvia un mensaje para preguntar si es estafa',
    reduces: [
      'suplantacion-entidad', 'evento-financiero-falso', 'plazo-administrativo',
      'phishing-credenciales', 'dominio-senuelo', 'pago-anticipado',
    ],
    // Este es el falso positivo mas comun del producto: alguien pega la estafa
    // que ha recibido para preguntar. El texto ES una estafa; lo que cambia es
    // quien lo manda y para que.
    regex: /((me\s*(ha\s*)?(ha\s*)?lleg(ado|o)|he\s*recibido|acabo\s*de\s*recibir|mira\s*lo\s*que\s*me)[^.]{0,60}(esto?|este\s*mensaje|este\s*sms)?[^.]{0,40}(es\s*(una\s*)?estafa|sera\s*estafa|es\s*fiable|es\s*verdad|es\s*real|tu\s*que\s*crees)|¿?(esto|este\s*mensaje|este\s*sms)\s*es\s*(una\s*)?(estafa|timo|phishing|fraude)\??)/,
  }),
];

// =============================================================================
// Huella del lexico
//
// Un reporte de un falso positivo sin saber contra QUE version del lexico se
// produjo no sirve de mucho: llegaria una queja sobre una entrada que ya se
// corrigio hace tres versiones y no habria forma de distinguirla de una queja
// actual.
//
// Se calcula, no se mantiene a mano. Una constante que hay que acordarse de
// subir cada vez que se toca una entrada acaba mintiendo — y miente en
// silencio, que es lo peor que puede hacer un numero de version. Aqui la huella
// sale de las propias entradas: si cambia una regex, cambia la huella, sin que
// nadie tenga que hacer nada.
// =============================================================================

/**
 * FNV-1a de 32 bits. Ni criptografico ni falta que hace: lo unico que se le
 * pide es cambiar cuando cambie la entrada, y eso lo cumple de sobra.
 */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Identifica el vocabulario vigente: entradas, combinaciones y amortiguadores.
 *
 * Los tres cuentan porque los tres cambian el veredicto. Un amortiguador nuevo
 * puede convertir un falso positivo en un acierto sin que ninguna entrada se
 * haya tocado.
 */
export const LEXICON_VERSION: string = fnv1a([
  ...LEXICON.map((e) => `${e.id}|${e.weight}|${e.regex.source}`),
  ...COMBOS.map((c) => `combo:${c.label}|${c.bonus}|${[...c.requires].sort().join(',')}`),
  ...DAMPENERS.map((d) => `damp:${d.id}|${d.regex.source}|${[...d.reduces].sort().join(',')}`),
].sort().join('\n'));

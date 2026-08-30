// =============================================================================
// Threat Dictionary — palabra por palabra, con conjugaciones y auto-aprendizaje
//
// El lexicon existente usa regex para frases completas. Eso detecta bien cuando
// alguien escribe *exactamente* esa frase, pero en una conversación de voz las
// amenazas llegan fragmentadas, con conjugaciones variadas y vocabulario
// informal. Este módulo resuelve eso:
//
//   1. Tiene un DICCIONARIO de palabras clave organizadas por categoría de
//      amenaza, con todas las conjugaciones comunes de cada verbo en español.
//
//   2. Cuenta cuántas palabras de cada categoría aparecen en el texto
//      (scoring por densidad). Una sola palabra no alerta; pero "paga" +
//      "ahora" + "te mato" cruza el umbral aunque las palabras no formen
//      una frase que un regex capture.
//
//   3. Se ALIMENTA AUTOMÁTICAMENTE: cuando una amenaza se confirma como
//      PELIGROSO, las palabras poco comunes del texto se guardan en localStorage
//      y se suman al diccionario en el siguiente escaneo. Así la detección
//      mejora con el uso.
//
// Diseño conservador: las palabras aisladas pesan poco. Un "banco" o "urgente"
// aislado no dispara nada. El puntaje sube cuando CONVERGEN palabras de
// categorías que juntas forman la forma de una amenaza real.
// =============================================================================

import { normalizeForMatching } from './scamPatterns';

// ── Tipos ────────────────────────────────────────────────────────────────────

export type DictCategory =
  | 'extorsion'
  | 'bullying'
  | 'sextorsion'
  | 'fraude-financiero'
  | 'phishing-datos'
  | 'secuestro-virtual'
  | 'amenaza-violencia'
  | 'manipulacion-emocional'
  | 'suplantacion'
  | 'estafa-romantica'
  | 'autolesion'
  | 'urgencia';

export interface DictScanResult {
  /** Puntaje bruto del diccionario (0–100). */
  score: number;
  /** Categorías que tuvieron hits. */
  categories: DictCategory[];
  /** Palabras individuales que coincidieron, para diagnóstico. */
  matchedWords: string[];
  /** Puntaje por categoría, para combos. */
  categoryScores: Partial<Record<DictCategory, number>>;
}

// ── Conjugador automático de verbos ──────────────────────────────────────────
//
// En español un verbo tiene ~50 formas. No las necesitamos todas — solo las que
// alguien diría en una llamada de amenaza: imperativo, presente, futuro coloquial
// y gerundio. El infinitivo ya viene como raíz.
//
// Cubre -ar, -er, -ir regulares. Verbos irregulares frecuentes se agregan
// como formas explícitas en el diccionario.

function conjugate(infinitive: string): string[] {
  const forms = new Set<string>();
  forms.add(infinitive);

  const root = infinitive.slice(0, -2);
  const ending = infinitive.slice(-2);

  if (ending === 'ar') {
    // presente: yo -o, tu -as, el -a, nosotros -amos, ellos -an
    forms.add(root + 'o');
    forms.add(root + 'as');
    forms.add(root + 'a');
    forms.add(root + 'amos');
    forms.add(root + 'an');
    // imperativo: -a (tu), -e (usted), -en (ustedes), -á (vos)
    forms.add(root + 'a');
    forms.add(root + 'e');
    forms.add(root + 'en');
    // futuro: -aré, -arás, -ará, -arán
    forms.add(infinitive + 'e');
    forms.add(infinitive + 'as');
    forms.add(infinitive + 'a');
    forms.add(infinitive + 'an');
    // gerundio
    forms.add(root + 'ando');
    // participio
    forms.add(root + 'ado');
    // preterito: -é, -ó, -aste, -aron
    forms.add(root + 'e');
    forms.add(root + 'o');
    forms.add(root + 'aste');
    forms.add(root + 'aron');
  } else if (ending === 'er') {
    forms.add(root + 'o');
    forms.add(root + 'es');
    forms.add(root + 'e');
    forms.add(root + 'emos');
    forms.add(root + 'en');
    forms.add(infinitive + 'e');
    forms.add(infinitive + 'as');
    forms.add(infinitive + 'a');
    forms.add(infinitive + 'an');
    forms.add(root + 'iendo');
    forms.add(root + 'ido');
    forms.add(root + 'io');
    forms.add(root + 'iste');
    forms.add(root + 'ieron');
  } else if (ending === 'ir') {
    forms.add(root + 'o');
    forms.add(root + 'es');
    forms.add(root + 'e');
    forms.add(root + 'imos');
    forms.add(root + 'en');
    forms.add(infinitive + 'e');
    forms.add(infinitive + 'as');
    forms.add(infinitive + 'a');
    forms.add(infinitive + 'an');
    forms.add(root + 'iendo');
    forms.add(root + 'ido');
    forms.add(root + 'io');
    forms.add(root + 'iste');
    forms.add(root + 'ieron');
  }

  return [...forms];
}

/** Expande un verbo con conjugaciones + formas explícitas adicionales. */
function verb(infinitive: string, ...extras: string[]): string[] {
  return [...conjugate(infinitive), ...extras];
}

// ── Diccionario de palabras clave por categoría ──────────────────────────────
//
// Cada categoría tiene:
//   words — palabras y conjugaciones que contribuyen al puntaje
//   weight — cuánto pesa CADA hit de esta categoría
//   maxHits — tope de hits que se cuentan (evita que una retahíla de insultos
//             domine todo el puntaje)

interface CategoryDef {
  id: DictCategory;
  weight: number;
  maxHits: number;
  words: string[];
}

const DICT: readonly CategoryDef[] = [
  // ── EXTORSIÓN ──────────────────────────────────────────────────────────
  {
    id: 'extorsion',
    weight: 5,
    maxHits: 8,
    words: [
      // Verbos de pago
      ...verb('pagar', 'paga', 'pagame', 'paganos', 'paguen', 'vas a pagar', 'pagale'),
      ...verb('cobrar', 'cobro', 'cobrame', 'cobramos', 'cobrale', 'te cobro'),
      ...verb('depositar', 'deposita', 'depositame', 'depositale', 'depositen'),
      ...verb('transferir', 'transfiere', 'transfierme', 'transfiereme'),
      // Amenazas condicionales
      'si no', 'sino', 'o si no', 'o te', 'o le',
      'atente a las consecuencias', 'vas a ver', 'te va a pesar',
      'te vas a arrepentir', 'te va a costar', 'la vas a pagar',
      'me las vas a pagar', 'te va a ir mal',
      // Exigencias
      'obedece', 'obedeceme', 'haz lo que te digo', 'haz lo que te pido',
      'calladito', 'calladita', 'sin preguntas', 'no preguntes',
      // Presión
      'ultima advertencia', 'ultima oportunidad', 'ultima vez',
      'te lo advierto', 'ya te avise', 'no me busques',
    ],
  },

  // ── BULLYING / ACOSO ───────────────────────────────────────────────────
  {
    id: 'bullying',
    weight: 4,
    maxHits: 10,
    words: [
      // Insultos comunes
      'idiota', 'imbecil', 'estupido', 'estupida', 'tarado', 'tarada',
      'tonto', 'tonta', 'pendejo', 'pendeja', 'animal', 'bestia',
      'maldito', 'maldita', 'desgraciado', 'desgraciada',
      'infeliz', 'inutil', 'basura', 'escoria', 'lacra',
      'perra', 'cerda', 'zorra', 'puta', 'fea', 'gordo', 'gorda',
      'asqueroso', 'asquerosa', 'cochino', 'cochina',
      'marica', 'maricon', 'naco', 'naca', 'corriente',
      'fracasado', 'fracasada', 'mediocre', 'patetico', 'patetica',
      'ridículo', 'ridiculo', 'ridicula',
      // Desprecio y humillación
      'no sirves para nada', 'no vales nada', 'eres una basura',
      'das asco', 'das pena', 'das lastima',
      'nadie te quiere', 'nadie te soporta', 'todo el mundo te odia',
      'eres lo peor', 'eres patético', 'eres patetica',
      // Rechazo/exclusión
      'nadie te va a extranar', 'nadie te necesita',
      'el mundo estaria mejor sin ti', 'desaparece',
      'pudrete', 'vete a la mierda', 'largate',
      // Acoso con amenaza implícita
      'te voy a arruinar la vida', 'te voy a destruir',
      'te voy a hundir', 'voy a acabar contigo',
      'voy a hacer tu vida imposible',
      'todo el mundo se va a enterar', 'voy a exhibirte',
      'le voy a contar a todos',
      // Mal trato
      'mal educado', 'mal educada', 'grosero', 'grosera',
    ],
  },

  // ── SEXTORSIÓN ─────────────────────────────────────────────────────────
  {
    id: 'sextorsion',
    weight: 6,
    maxHits: 6,
    words: [
      // Contenido íntimo
      'fotos intimas', 'video intimo', 'videos intimos', 'desnudo', 'desnuda',
      'desnudos', 'desnudas', 'nudes', 'pack',
      'fotos comprometedoras', 'video comprometedor',
      'contenido intimo', 'material intimo',
      // Acciones de difusión en contexto de sextorsión
      'publicar tus fotos', 'publicare tus fotos', 'difundir tus fotos',
      'subir tus fotos', 'subir tus videos', 'exhibir tus fotos',
      'mostrar tus fotos', 'mandar tus fotos', 'enviar tus fotos',
      'publicar tu video', 'difundir tu video', 'subir tu video',
      // Destinos
      'a tu familia', 'a tus contactos', 'a tu trabajo', 'a tu jefe',
      'en redes', 'en internet', 'en facebook', 'en instagram', 'en tiktok',
      'por whatsapp', 'a todos', 'a todo el mundo',
      // Chantaje
      'si no pagas', 'si no depositas', 'si no me mandas',
      'tengo tus fotos', 'tengo tus videos', 'tengo tu video',
      'grabe todo', 'te grabe', 'te tengo grabado', 'te tengo grabada',
    ],
  },

  // ── FRAUDE FINANCIERO ──────────────────────────────────────────────────
  {
    id: 'fraude-financiero',
    weight: 4,
    maxHits: 8,
    words: [
      // Solicitud de dinero
      'dinero', 'plata', 'lana', 'feria', 'varo', 'varos',
      'guita', 'billete', 'billetes', 'billullo', 'baro', 'baros',
      'enviame dinero', 'mandame dinero', 'pasame dinero', 'depositame dinero',
      'enviame la lana', 'mandame la lana', 'pasame la lana',
      'prestame dinero', 'prestame plata', 'ayuda economica',
      'necesito dinero', 'necesito plata', 'necesito la lana',
      // Medios de pago
      'transferencia', 'deposito', 'western union', 'moneygram',
      'oxxo', 'banco azteca', 'giro postal',
      'bitcoin', 'crypto', 'criptomoneda', 'usdt', 'wallet', 'binance',
      'tarjeta de regalo', 'gift card', 'paysafe', 'recarga',
      // Tarjetas
      'tarjeta de credito', 'tarjeta de debito',
      'numero de tarjeta', 'numero de cuenta',
      // Urgencia financiera
      'es urgente', 'ahora mismo', 'inmediatamente',
    ],
  },

  // ── PHISHING / ROBO DE DATOS ───────────────────────────────────────────
  {
    id: 'phishing-datos',
    weight: 5,
    maxHits: 7,
    words: [
      // Datos que piden
      'contrasena', 'password', 'clave', 'nip', 'pin', 'otp', 'token',
      'codigo de verificacion', 'codigo de seguridad', 'codigo que te llego',
      'numero de cuenta', 'numero de tarjeta',
      'clave de acceso', 'clave de seguridad',
      'fecha de vencimiento', 'cvv', 'cvc',
      'datos personales', 'datos bancarios',
      'curp', 'rfc', 'ine', 'dni', 'pasaporte', 'cedula',
      // Acciones de robo explicitas
      'dame tu clave', 'dame tus datos', 'pasame tu clave', 'pasame tus datos',
      'dictame tu clave', 'dictame tus datos', 'dime tu clave', 'dime tus datos',
      'necesito tu clave', 'necesito tus datos', 'ingresa tu clave',
      'verificar tu cuenta', 'confirmar tu cuenta', 'validar tu cuenta',
      'verificar tus datos', 'confirmar tus datos', 'validar tus datos',
      // Selfie + documento
      'selfie con tu', 'foto de tu tarjeta',
      'foto de tu identificacion', 'selfie con tu ine',
      'selfie con tu dni', 'selfie con tu cedula',
    ],
  },

  // ── SECUESTRO VIRTUAL ──────────────────────────────────────────────────
  {
    id: 'secuestro-virtual',
    weight: 7,
    maxHits: 6,
    words: [
      // Fórmulas de retención
      'tengo a tu hijo', 'tengo a tu hija', 'tengo a tu mama',
      'tengo a tu papa', 'tengo a tu esposa', 'tengo a tu esposo',
      'tengo a tu hermano', 'tengo a tu hermana',
      'tengo a tu familia', 'tengo a tu nino', 'tengo a tu nina',
      'tenemos a tu', 'aqui tengo a tu', 'aqui tenemos a tu',
      'lo tengo aqui', 'la tengo aqui',
      'esta en nuestro poder', 'esta conmigo tu',
      // Pedido de rescate
      'rescate', 'liberar', 'entregar', 'devolver',
      ...verb('soltar', 'suelto', 'soltamos'),
      // Audio emocional
      'escucha a tu', 'oye como llora', 'oye como grita',
      'escuchalo', 'escuchala',
      // Retención en línea
      'no cuelgue', 'no cuelgues', 'no corte', 'no cortes',
      'quedese en la linea', 'quedate en la linea',
      'sigue en la linea', 'no apague el telefono', 'no apague el celular',
      'no cierre la llamada',
    ],
  },

  // ── AMENAZA DE VIOLENCIA ───────────────────────────────────────────────
  {
    id: 'amenaza-violencia',
    weight: 6,
    maxHits: 7,
    words: [
      // Amenazas directas
      ...verb('matar', 'te mato', 'te voy a matar', 'te vamos a matar',
        'vas a morir', 'te hago desaparecer', 'lo mato', 'la mato'),
      ...verb('golpear', 'te golpeo', 'te voy a golpear', 'te parto'),
      'te voy a hacer dano', 'te vamos a hacer dano',
      'te va a pasar algo', 'le va a pasar algo',
      'cuidate las espaldas', 'cuidese las espaldas',
      'te va a doler',
      // Ubicación/vigilancia
      'sabemos donde vives', 'conocemos tu direccion',
      'te estamos vigilando', 'te estoy vigilando',
      'te tenemos ubicado', 'te tenemos ubicada',
      'ya te tenemos identificado', 'ya te tenemos identificada',
      'sabemos quien eres', 'sabemos todo de ti',
      'tenemos tus datos', 'ya sabemos donde',
      // Ir al domicilio
      'vamos a tu casa', 'vamos a tu domicilio', 'vamos a tu trabajo',
      'iremos a tu casa', 'llegamos a tu casa',
      'estamos en tu domicilio', 'estaremos en tu domicilio',
      'nos presentamos en tu casa',
      // Femicidio/violencia de género (patrón detectado en reportes reales)
      'por eso las matan', 'por eso los matan',
      'x eso las matan', 'te gusta el mal trato',
      'te lo mereces', 'te lo buscaste',
    ],
  },

  // ── MANIPULACIÓN EMOCIONAL ─────────────────────────────────────────────
  {
    id: 'manipulacion-emocional',
    weight: 4,
    maxHits: 7,
    words: [
      // Aislamiento
      'no le digas a nadie', 'no le cuentes a nadie',
      'no avises a nadie', 'no hables con nadie',
      'es un secreto', 'entre nosotros', 'esto queda entre nosotros',
      'no le digas', 'no le cuentes', 'no avises',
      // Prohibición de contactar autoridades
      'no llames a la policia', 'no avises a la policia',
      'no vayas a la policia', 'no acudas a las autoridades',
      'no denuncies', 'no llames a nadie',
      // Manipulación
      'confia en mi', 'solo yo te quiero', 'solo yo te entiendo',
      'nadie te va a creer', 'es tu culpa', 'tu te lo buscaste',
      'si me quisieras', 'demuestra que me quieres',
      'si me amaras lo harias', 'lo haces porque te quiero',
      'es por tu bien', 'lo hago por tu bien',
      // Gaslighting
      'eso nunca paso', 'estas loco', 'estas loca', 'estas exagerando',
      'te lo estas inventando', 'nadie te va a creer',
      'no paso nada', 'fue tu culpa',
    ],
  },

  // ── SUPLANTACIÓN DE IDENTIDAD ──────────────────────────────────────────
  {
    id: 'suplantacion',
    weight: 6,
    maxHits: 6,
    words: [
      // Autoridades y presentaciones
      'comisario', 'comisaria', 'subcomisario', 'sargento', 'comisaria tercera',
      'oficial de policia', 'agente judicial', 'agente fiscal',
      'inspector de hacienda', 'inspector de impuestos',
      'juzgado', 'ministerio publico', 'fiscalia',
      'le habla el', 'le habla la', 'le llama el', 'le llama la',
      // Instituciones
      'le habla el banco', 'le llama el banco',
      'somos del banco', 'policia le contacta',
      'gobierno le informa', 'hacienda le contacta',
      'soporte tecnico', 'microsoft', 'apple support', 'tech support',
      // Acusaciones falsas
      'tiene una denuncia', 'se le abrio una causa', 'se le abrio una',
      'tiene una causa', 'existe un expediente',
      'orden de captura', 'orden de detencion', 'orden de allanamiento',
      'orden de arresto', 'orden a su nombre',
      // Delitos graves inventados
      'pedofilia', 'pornografia infantil', 'abuso de menores',
      'lavado de dinero', 'lavado de activos', 'narcotrafico',
      'trata de personas',
    ],
  },

  // ── ESTAFA ROMÁNTICA ───────────────────────────────────────────────────
  {
    id: 'estafa-romantica',
    weight: 4,
    maxHits: 7,
    words: [
      // Amor + dinero
      'te amo', 'mi amor', 'mi vida', 'carino', 'mi cielo',
      'mi corazon', 'te quiero mucho', 'amor de mi vida',
      // Emergencias falsas
      'estoy en el hospital', 'tuve un accidente',
      'estoy en emergencia', 'me operan',
      'necesito dinero para la operacion',
      // Militar/plataforma
      'soy militar', 'soldado', 'plataforma petrolera',
      'no puedo acceder a mi cuenta', 'mi cuenta esta bloqueada',
      'estoy en el extranjero',
      // Viaje
      'boleto de avion', 'pasaje', 'visa',
      'necesito para el pasaje', 'necesito para el boleto',
      // Peticiones con amor
      'hazlo por mi', 'hazlo por nuestro amor',
      'lo necesito para estar juntos', 'para por fin vernos',
      'es la unica forma', 'confia en mi amor',
    ],
  },

  // ── INDUCCIÓN A AUTOLESIÓN ─────────────────────────────────────────────
  {
    id: 'autolesion',
    weight: 10,
    maxHits: 4,
    words: [
      'matate', 'suicidate', 'ojala te mueras',
      'deberias morirte', 'deberias matarte',
      'el mundo estaria mejor sin ti', 'desaparece del mundo',
      'nadie te va a extranar', 'no mereces vivir',
      'cortate', 'hazte dano', 'acabate',
      'kill yourself', 'kys', 'you should die', 'go die',
      'nobody would miss you',
    ],
  },

  // ── URGENCIA / PRESIÓN ─────────────────────────────────────────────────
  {
    id: 'urgencia',
    weight: 3,
    maxHits: 5,
    words: [
      'urgente', 'urgentemente', 'inmediatamente', 'ahora mismo',
      'ahora ya', 'ya mismo', 'rapido', 'rapidamente',
      'ultima oportunidad', 'ultima vez', 'ultima advertencia',
      'solo hoy', 'solo tienes', 'expira hoy',
      'quedan pocos minutos', 'tienes 5 minutos', 'tienes 10 minutos',
      'se acaba el tiempo', 'antes de que sea tarde',
      'no hay tiempo', 'es ahora o nunca',
      'urgent', 'immediately', 'right now', 'hurry',
    ],
  },
];

// ── Lookup rápido ────────────────────────────────────────────────────────────
//
// Pre-indexa todas las palabras del diccionario en un Map para O(1) lookup.
// Para frases multi-palabra, las indexa como substrings que se buscan con
// includes() — más lento, pero necesario para "sabemos donde vives".

interface WordEntry {
  category: DictCategory;
  weight: number;
}

/** Palabras simples (1 token) → categoría + peso. */
const SINGLE_WORD_INDEX = new Map<string, WordEntry[]>();

/** Frases multi-palabra (2+ tokens) → categoría + peso. */
const MULTI_WORD_PHRASES: Array<{ phrase: string; category: DictCategory; weight: number }> = [];

function buildIndex() {
  if (SINGLE_WORD_INDEX.size > 0) return; // already built

  for (const cat of DICT) {
    for (const word of cat.words) {
      const normalized = normalizeForMatching(word);
      if (!normalized) continue;

      const tokens = normalized.split(' ');
      if (tokens.length === 1) {
        const entry: WordEntry = { category: cat.id, weight: cat.weight };
        const existing = SINGLE_WORD_INDEX.get(normalized);
        if (existing) {
          existing.push(entry);
        } else {
          SINGLE_WORD_INDEX.set(normalized, [entry]);
        }
      } else {
        MULTI_WORD_PHRASES.push({ phrase: normalized, category: cat.id, weight: cat.weight });
      }
    }
  }
}

// ── Base de datos de aprendizaje — IndexedDB ─────────────────────────────────
//
// El sistema anterior usaba localStorage (5MB, se borra con la caché).
// Este usa IndexedDB: sin límite práctico de tamaño, persiste entre sesiones
// y limpieza de caché, y permite búsquedas indexadas.
//
// Qué aprende:
//   - Palabras individuales (4+ caracteres, no stopwords)
//   - Bigramas (pares de palabras consecutivas) — captura "pagame ahora"
//   - Trigramas (tríos de palabras) — captura "dame tu clave"
//
// Cada entrada registra:
//   - La palabra/frase
//   - Su categoría de amenaza
//   - Cuántas veces se ha visto (frequency) — mayor frecuencia = más confiable
//   - Cuándo se vio por primera vez y última vez
//   - Un score de confianza basado en frecuencia
//
// Diseño conservador: las entradas aprendidas pesan MENOS que las del
// diccionario base. Solo cuando una frase se confirma repetidamente su
// peso sube. Una detección errónea aislada no contamina el sistema.

const LEARNED_DB_NAME = 'nada-learned-dict';
const LEARNED_DB_VERSION = 1;
const LEARNED_STORE = 'learned-entries';
const MAX_LEARNED_ENTRIES = 2000;

/** Weight for a learned word hit. Scales with frequency. */
const LEARNED_BASE_WEIGHT = 2;
const LEARNED_MAX_WEIGHT = 5;

/** Palabras demasiado comunes para aprender. */
const COMMON_WORDS = new Set([
  'que', 'de', 'la', 'el', 'en', 'y', 'a', 'los', 'las', 'un', 'una', 'por',
  'con', 'no', 'se', 'su', 'lo', 'le', 'me', 'te', 'mi', 'tu', 'es', 'son',
  'para', 'del', 'al', 'como', 'mas', 'pero', 'si', 'ya', 'yo', 'esta', 'este',
  'esto', 'muy', 'hay', 'ser', 'fue', 'era', 'tiene', 'puede', 'hoy', 'dia',
  'eso', 'esa', 'ese', 'asi', 'bien', 'todo', 'donde', 'cuando', 'porque',
  'entonces', 'tambien', 'solo', 'otro', 'otra', 'va', 'voy', 'tengo',
  'he', 'ha', 'han', 'hemos', 'dos', 'tres', 'uno', 'bueno', 'buena',
  'usted', 'ustedes', 'nosotros', 'ellos', 'ellas', 'cual', 'mucho', 'mucha',
  'the', 'and', 'you', 'to', 'of', 'in', 'is', 'it', 'for', 'on', 'that',
  'this', 'with', 'be', 'are', 'was', 'not', 'will', 'have', 'has',
  'ver', 'hacer', 'dice', 'dijo', 'creo', 'sabe', 'quiero', 'puede',
  'vamos', 'viene', 'esta', 'estan', 'estas', 'estoy',
]);

export interface LearnedEntry {
  /** The word or phrase (normalized). */
  key: string;
  /** Threat category it was associated with. */
  category: DictCategory;
  /** How many times this has been seen in confirmed threats. */
  frequency: number;
  /** ms epoch of first sighting. */
  firstSeen: number;
  /** ms epoch of latest sighting. */
  lastSeen: number;
  /** 'word' | 'bigram' | 'trigram'. */
  type: 'word' | 'bigram' | 'trigram';
}

// In-memory mirror loaded from IDB. The scanner reads this; IDB writes happen
// async in the background so they never block a scan.
let learnedMirror: LearnedEntry[] = [];
let learnedDB: IDBDatabase | null = null;
let dbInitPromise: Promise<boolean> | null = null;

async function initLearnedDB(): Promise<boolean> {
  if (learnedDB) return true;
  if (dbInitPromise) return dbInitPromise;

  dbInitPromise = new Promise<boolean>((resolve) => {
    try {
      const request = indexedDB.open(LEARNED_DB_NAME, LEARNED_DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(LEARNED_STORE)) {
          const store = db.createObjectStore(LEARNED_STORE, { keyPath: 'key' });
          store.createIndex('category', 'category', { unique: false });
          store.createIndex('frequency', 'frequency', { unique: false });
          store.createIndex('lastSeen', 'lastSeen', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        learnedDB = (event.target as IDBOpenDBRequest).result;
        // Load everything into memory for fast scanning
        void loadMirrorFromDB();
        resolve(true);
      };

      request.onerror = () => {
        console.warn('[NADA][dict] Failed to open learned dictionary DB');
        resolve(false);
      };
    } catch {
      resolve(false);
    }
  });

  return dbInitPromise;
}

async function loadMirrorFromDB(): Promise<void> {
  if (!learnedDB) return;
  return new Promise<void>((resolve) => {
    try {
      const tx = learnedDB!.transaction(LEARNED_STORE, 'readonly');
      const store = tx.objectStore(LEARNED_STORE);
      const request = store.getAll();
      request.onsuccess = () => {
        learnedMirror = (request.result ?? []) as LearnedEntry[];
        resolve();
      };
      request.onerror = () => {
        resolve();
      };
    } catch {
      resolve();
    }
  });
}

/** Persists an entry to IDB and updates the in-memory mirror. */
async function upsertEntry(entry: LearnedEntry): Promise<void> {
  // Update mirror immediately (sync, for the scanner)
  const idx = learnedMirror.findIndex((e) => e.key === entry.key);
  if (idx >= 0) {
    learnedMirror[idx] = entry;
  } else {
    learnedMirror.push(entry);
  }

  // Persist to IDB (async, fire-and-forget)
  if (!learnedDB) return;
  try {
    const tx = learnedDB.transaction(LEARNED_STORE, 'readwrite');
    const store = tx.objectStore(LEARNED_STORE);
    store.put(entry);
  } catch { /* IDB write failed silently */ }
}

/** Evicts oldest entries if over the limit. */
async function evictIfNeeded(): Promise<void> {
  if (learnedMirror.length <= MAX_LEARNED_ENTRIES) return;

  // Keep the most recently seen entries
  learnedMirror.sort((a, b) => b.lastSeen - a.lastSeen);
  const toRemove = learnedMirror.splice(MAX_LEARNED_ENTRIES);

  if (!learnedDB || toRemove.length === 0) return;
  try {
    const tx = learnedDB.transaction(LEARNED_STORE, 'readwrite');
    const store = tx.objectStore(LEARNED_STORE);
    for (const entry of toRemove) {
      store.delete(entry.key);
    }
  } catch { /* eviction failed silently */ }
}

/** Extracts meaningful words from normalized text. */
function extractLearnableWords(normalizedText: string): string[] {
  return normalizedText.split(' ').filter(
    (w) => w.length >= 4 && !COMMON_WORDS.has(w),
  );
}

/** Extracts bigrams (pairs) from word list. */
function extractBigrams(words: string[]): string[] {
  const bigrams: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    const a = words[i]!;
    const b = words[i + 1]!;
    // At least one word must be meaningful (not a stopword)
    if (a.length >= 4 || b.length >= 4) {
      bigrams.push(`${a} ${b}`);
    }
  }
  return bigrams;
}

/** Extracts trigrams (trios) from word list. */
function extractTrigrams(words: string[]): string[] {
  const trigrams: string[] = [];
  for (let i = 0; i < words.length - 2; i++) {
    const a = words[i]!;
    const b = words[i + 1]!;
    const c = words[i + 2]!;
    // At least two words must be meaningful
    const meaningful = [a, b, c].filter((w) => w.length >= 4 && !COMMON_WORDS.has(w));
    if (meaningful.length >= 2) {
      trigrams.push(`${a} ${b} ${c}`);
    }
  }
  return trigrams;
}

/**
 * Learns from a confirmed threat.
 *
 * Extracts words, bigrams and trigrams and stores/updates them in IndexedDB.
 * If a phrase was seen before, its frequency increases — making it more
 * reliable over time. New phrases start with frequency 1 and low weight.
 *
 * Only called for PELIGROSO verdicts. SOSPECHOSO is too uncertain.
 */
export async function learnWordsFromThreat(
  normalizedText: string,
  detectedCategories: DictCategory[],
): Promise<void> {
  if (detectedCategories.length === 0) return;
  await initLearnedDB();

  buildIndex();
  const allWords = normalizedText.split(' ').filter(Boolean);
  const primaryCategory = detectedCategories[0]!;
  const now = Date.now();

  // 1. Single words
  const meaningfulWords = extractLearnableWords(normalizedText);
  for (const word of meaningfulWords) {
    if (SINGLE_WORD_INDEX.has(word)) continue; // already in base dict
    const existing = learnedMirror.find((e) => e.key === word);
    if (existing) {
      existing.frequency++;
      existing.lastSeen = now;
      // Update category if this category is different and more specific
      if (detectedCategories.includes(existing.category as DictCategory)) {
        existing.lastSeen = now;
      }
      await upsertEntry(existing);
    } else {
      await upsertEntry({
        key: word,
        category: primaryCategory,
        frequency: 1,
        firstSeen: now,
        lastSeen: now,
        type: 'word',
      });
    }
  }

  // 2. Bigrams — capture 2-word patterns like "pagame ahora"
  const bigrams = extractBigrams(allWords);
  for (const bigram of bigrams) {
    const existing = learnedMirror.find((e) => e.key === bigram);
    if (existing) {
      existing.frequency++;
      existing.lastSeen = now;
      await upsertEntry(existing);
    } else {
      await upsertEntry({
        key: bigram,
        category: primaryCategory,
        frequency: 1,
        firstSeen: now,
        lastSeen: now,
        type: 'bigram',
      });
    }
  }

  // 3. Trigrams — capture 3-word patterns like "dame tu clave"
  const trigrams = extractTrigrams(allWords);
  for (const trigram of trigrams) {
    const existing = learnedMirror.find((e) => e.key === trigram);
    if (existing) {
      existing.frequency++;
      existing.lastSeen = now;
      await upsertEntry(existing);
    } else {
      await upsertEntry({
        key: trigram,
        category: primaryCategory,
        frequency: 1,
        firstSeen: now,
        lastSeen: now,
        type: 'trigram',
      });
    }
  }

  await evictIfNeeded();
}

/** How many entries the dictionary has learned. */
export function learnedDictSize(): number {
  return learnedMirror.length;
}

/** Breakdown of learned entries by type. */
export function learnedDictStats(): { words: number; bigrams: number; trigrams: number; total: number } {
  const words = learnedMirror.filter((e) => e.type === 'word').length;
  const bigrams = learnedMirror.filter((e) => e.type === 'bigram').length;
  const trigrams = learnedMirror.filter((e) => e.type === 'trigram').length;
  return { words, bigrams, trigrams, total: learnedMirror.length };
}

/** Wipes the entire learned dictionary — user-facing reset. */
export async function clearLearnedDict(): Promise<void> {
  learnedMirror = [];
  if (!learnedDB) return;
  try {
    const tx = learnedDB.transaction(LEARNED_STORE, 'readwrite');
    const store = tx.objectStore(LEARNED_STORE);
    store.clear();
  } catch { /* clear failed silently */ }
}

/** Initialize the DB early so the mirror is ready when the first scan arrives. */
export function initDictDB(): void {
  void initLearnedDB();
}

/** Calculates the effective weight for a learned entry based on frequency. */
function learnedWeight(entry: LearnedEntry): number {
  // frequency 1 → base weight, scales up to max at frequency 5+
  const scale = Math.min(entry.frequency, 5) / 5;
  return LEARNED_BASE_WEIGHT + (LEARNED_MAX_WEIGHT - LEARNED_BASE_WEIGHT) * scale;
}

// ── Scanner principal ────────────────────────────────────────────────────────

/**
 * Scans normalized text against the threat dictionary.
 *
 * Returns a score (0–100) and the categories hit. The score is additive:
 * each matching word from a category contributes that category's weight,
 * capped by maxHits per category. Cross-category convergence is what
 * makes the score climb, not repeating one word many times.
 */
export function scanDictionary(text: string): DictScanResult {
  buildIndex();

  const haystack = normalizeForMatching(text);
  const tokens = haystack.split(' ').filter(Boolean);

  const hitCounts = new Map<DictCategory, number>();
  const catWeights = new Map<DictCategory, number>();
  const catMaxHits = new Map<DictCategory, number>();
  const matchedWords: string[] = [];
  const categoryScores: Partial<Record<DictCategory, number>> = {};

  // Initialize category limits from DICT
  for (const cat of DICT) {
    hitCounts.set(cat.id, 0);
    catWeights.set(cat.id, cat.weight);
    catMaxHits.set(cat.id, cat.maxHits);
  }

  // 1. Single-word matches — O(n) scan over tokens
  const alreadyCounted = new Set<string>();
  for (const token of tokens) {
    if (alreadyCounted.has(token)) continue;
    const entries = SINGLE_WORD_INDEX.get(token);
    if (!entries) continue;

    for (const entry of entries) {
      const current = hitCounts.get(entry.category) ?? 0;
      const max = catMaxHits.get(entry.category) ?? 999;
      if (current < max) {
        hitCounts.set(entry.category, current + 1);
        if (!alreadyCounted.has(token)) matchedWords.push(token);
      }
    }
    alreadyCounted.add(token);
  }

  // 2. Multi-word phrase matches — substring search
  for (const entry of MULTI_WORD_PHRASES) {
    if (!haystack.includes(entry.phrase)) continue;
    const current = hitCounts.get(entry.category) ?? 0;
    const max = catMaxHits.get(entry.category) ?? 999;
    if (current < max) {
      hitCounts.set(entry.category, current + 1);
      matchedWords.push(entry.phrase);
    }
  }

  // 3. Learned entries from IndexedDB — words, bigrams and trigrams
  //    These come from confirmed threats and grow with use. Frequency-based
  //    weighting means a phrase seen once barely contributes; one seen 5+ times
  //    carries as much as a base dictionary word.
  let learnedScore = 0;
  for (const entry of learnedMirror) {
    if (entry.type === 'word') {
      if (alreadyCounted.has(entry.key)) continue;
      if (!tokens.includes(entry.key)) continue;
      const w = learnedWeight(entry);
      learnedScore += w;
      matchedWords.push(entry.key);
      alreadyCounted.add(entry.key);
      // Also count toward category hits
      const current = hitCounts.get(entry.category) ?? 0;
      const max = catMaxHits.get(entry.category) ?? 999;
      if (current < max) {
        hitCounts.set(entry.category, current + 1);
      }
    } else {
      // bigram or trigram — substring match
      if (!haystack.includes(entry.key)) continue;
      const w = learnedWeight(entry);
      // Bigrams/trigrams are more specific → worth more
      learnedScore += w * (entry.type === 'trigram' ? 1.5 : 1.2);
      matchedWords.push(entry.key);
      const current = hitCounts.get(entry.category) ?? 0;
      const max = catMaxHits.get(entry.category) ?? 999;
      if (current < max) {
        hitCounts.set(entry.category, current + 1);
      }
    }
  }

  // 4. Compute per-category and total scores
  let totalScore = 0;
  const categoriesHit: DictCategory[] = [];

  for (const [catId, hits] of hitCounts) {
    if (hits === 0) continue;
    const weight = catWeights.get(catId) ?? 0;
    const catScore = hits * weight;
    categoryScores[catId] = catScore;
    totalScore += catScore;
    categoriesHit.push(catId);
  }

  // Add learned score (capped so it corroborates but doesn't dominate)
  totalScore += Math.min(Math.round(learnedScore), 25);

  // 5. Cross-category convergence bonus
  //    Two categories hitting → +10; three → +20; four+ → +30
  if (categoriesHit.length >= 4) totalScore += 30;
  else if (categoriesHit.length >= 3) totalScore += 20;
  else if (categoriesHit.length >= 2) totalScore += 10;

  const score = Math.min(100, totalScore);

  return { score, categories: categoriesHit, matchedWords, categoryScores };
}

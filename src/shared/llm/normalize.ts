// =============================================================================
// Endurecimiento Unicode de la entrada
//
// El filtro anterior era una lista de frases prohibidas en español e ingles.
// Se evadia con un espacio de ancho cero en medio de la palabra, o cambiando
// una "a" latina por la "a" cirilica, que se ve identica y no es la misma letra.
// Ninguna lista de frases sobrevive a eso, porque el atacante escribe despues
// de leer la lista.
//
// Asi que aqui no se decide nada sobre el contenido: solo se le quita al texto
// la capacidad de disfrazarse. Lo que quede se analiza tal cual.
//
// Los caracteres se escriben como escapes \u a proposito: un invisible literal
// en el fuente es invisible tambien para quien revise este archivo.
// =============================================================================

/**
 * Tope de longitud.
 *
 * El portapapeles y el OCR de pantalla mandaban lo que hubiera, sin limite: una
 * pagina entera copiada eran decenas de miles de caracteres de superficie de
 * inyeccion, y una peticion de cuota quemada por cada una. 4000 caracteres
 * cubren de sobra un mensaje de chat, un SMS o una captura de WhatsApp.
 */
export const MAX_ANALYSIS_CHARS = 4000;

/**
 * Invisibles: zero-width, controles de direccion bidi, guion blando y BOM.
 * No aportan nada a un mensaje real y son el vector de evasion mas barato.
 */
const INVISIBLE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

/** Controles C0/C1 salvo tabulador y salto de linea, que si aparecen en texto real. */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/** Diacriticos combinantes que deja NFD. */
const COMBINING = /[\u0300-\u036F]/g;

/**
 * Homoglifos: caracteres cirilicos y griegos que se dibujan igual que latinos.
 * "Ignora" con "a" cirilica no lo ve ningun patron escrito en latino.
 */
const HOMOGLYPHS: Record<string, string> = {
  // Cirilico minuscula
  'а': 'a', 'в': 'b', 'е': 'e', 'к': 'k', 'м': 'm',
  'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c', 'т': 't',
  'у': 'y', 'х': 'x', 'і': 'i', 'ј': 'j', 'ѕ': 's',
  // Cirilico mayuscula
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M',
  'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T',
  'У': 'Y', 'Х': 'X', 'І': 'I', 'Ј': 'J', 'Ѕ': 'S',
  // Griego minuscula
  'ο': 'o', 'α': 'a', 'ν': 'v', 'ρ': 'p', 'τ': 't',
  'υ': 'u', 'ι': 'i', 'κ': 'k',
  // Griego mayuscula
  'Ο': 'O', 'Α': 'A', 'Ρ': 'P', 'Τ': 'T', 'Υ': 'Y',
  'Κ': 'K', 'Ε': 'E', 'Ι': 'I',
};

const HOMOGLYPH_RE = new RegExp(`[${Object.keys(HOMOGLYPHS).join('')}]`, 'g');

export interface HardenResult {
  text: string;
  originalLength: number;
  truncated: boolean;
  invisibleCharsRemoved: number;
  homoglyphsFolded: number;
}

/**
 * Prepara el texto para viajar como dato.
 *
 * Conserva el mensaje legible — el modelo tiene que ver lo que la victima vio —
 * pero sin invisibles, sin controles y con los homoglifos devueltos a su letra
 * latina. Compatibilidad NFKC de paso, que colapsa variantes de ancho completo.
 */
export function hardenInput(raw: string): HardenResult {
  const originalLength = raw.length;
  const nfkc = raw.normalize('NFKC');

  let invisibleCharsRemoved = 0;
  const countAndDrop = () => {
    invisibleCharsRemoved += 1;
    return '';
  };
  const withoutInvisible = nfkc.replace(INVISIBLE, countAndDrop).replace(CONTROL, countAndDrop);

  let homoglyphsFolded = 0;
  const folded = withoutInvisible.replace(HOMOGLYPH_RE, (ch) => {
    homoglyphsFolded += 1;
    return HOMOGLYPHS[ch] ?? ch;
  });

  const truncated = folded.length > MAX_ANALYSIS_CHARS;
  const text = truncated ? folded.slice(0, MAX_ANALYSIS_CHARS) : folded;

  return { text, originalLength, truncated, invisibleCharsRemoved, homoglyphsFolded };
}

/**
 * Forma agresiva, solo para comparar contra patrones.
 * Nunca se manda al modelo: pierde acentos y mayusculas, que a un lector humano
 * le importan y a una expresion regular no.
 */
export function foldForScan(text: string): string {
  return hardenInput(text)
    .text.normalize('NFD')
    .replace(COMBINING, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

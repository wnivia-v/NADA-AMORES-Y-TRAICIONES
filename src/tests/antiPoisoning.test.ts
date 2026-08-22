// =============================================================================
// Invariantes contra el envenenamiento del corpus
//
// Modo B recoge reportes de personas usuarias, y esos reportes llevan texto de
// estafadores. El backoffice lee ese material y de ahi salen propuestas de
// reglas nuevas. Todo el modelo de contencion —el agente propone, se MIDE, y
// una persona aprueba— descansa en una separacion que hasta ahora existia de
// hecho pero no estaba escrita en ninguna parte:
//
//   el corpus contra el que se mide una propuesta esta VERSIONADO y curado a
//   mano; los reportes aterrizan en PostgreSQL y no lo tocan nunca.
//
// Si un cambio futuro cablea los reportes al corpus, la puerta que juzga las
// propuestas queda envenenada junto con la regla que deberia juzgar: el atacante
// manda casos etiquetados a su gusto, y despues la propuesta que los aprovecha
// pasa la medicion porque el examen lo escribio el. Seguiria habiendo aprobacion
// humana, pero quien aprueba estaria leyendo metricas fabricadas.
//
// Estos tests no prueban comportamiento: prueban que esa costura sigue sin
// existir. Miran el fuente a proposito, porque un cableado asi no se nota
// ejecutando nada — se nota leyendo los imports, y solo si alguien mira.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import corpus from '@/data/scam-corpus.json';
import { buildAnalysisRequest } from '@/shared/llm/envelope';

const RAIZ = join(__dirname, '..', '..');

function fuentes(dir: string, out: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    if (nombre === 'node_modules' || nombre === 'dist' || nombre.startsWith('.')) continue;
    const p = join(dir, nombre);
    if (statSync(p).isDirectory()) fuentes(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(nombre)) out.push(p);
  }
  return out;
}

describe('el corpus de medicion y los reportes no se tocan', () => {
  /**
   * Quien puede leer el corpus DENTRO del producto, y por que.
   *
   * Los bancos (bench/) quedan fuera de la cuenta como categoria: se ejecutan a
   * mano, no se empaquetan y no reciben reportes de nadie. Nombrarlos uno a uno
   * solo añadia fricción cada vez que alguien escribe un banco nuevo, sin
   * proteger nada — y una comprobacion que molesta sin motivo termina relajada.
   *
   * Dentro de src/ y server/ si es lista blanca por nombre: ahi cada lector
   * nuevo es una decision que hay que justificar por escrito.
   */
  const LECTORES_PERMITIDOS = [
    // Clasifica por similitud EN EL DISPOSITIVO. Lee el corpus como datos de
    // referencia; no escribe en el y no ve reportes de nadie mas.
    'src/services/aiProviders/localProvider.ts',
  ];

  it('dentro del producto solo lo lee el clasificador local', () => {
    const lectores = fuentes(RAIZ)
      .map((p) => relative(RAIZ, p))
      .filter((p) => p.startsWith('src/') || p.startsWith('server/'))
      .filter((p) => !p.startsWith('src/tests/'))
      .filter((p) => /scam-corpus/.test(readFileSync(join(RAIZ, p), 'utf8')));

    for (const lector of lectores) {
      expect(
        LECTORES_PERMITIDOS,
        `${lector} lee el corpus de medicion. Si es a proposito, añadelo a ` +
          'LECTORES_PERMITIDOS con el motivo. Si viene del camino de reportes, ' +
          'para: eso deja que el atacante escriba el examen con el que se le juzga.',
      ).toContain(lector);
    }
  });

  it('el servidor —que es quien recibe los reportes— no lo lee en absoluto', () => {
    const enServidor = fuentes(join(RAIZ, 'server'))
      .filter((p) => /scam-corpus|regional-cases/.test(readFileSync(p, 'utf8')))
      .map((p) => relative(RAIZ, p));

    expect(enServidor).toEqual([]);
  });

  it('nada en el producto escribe sobre los datos versionados', () => {
    // Un import es de solo lectura, pero fs.writeFile con una ruta a src/data
    // no lo seria. Aqui no deberia haber ninguno.
    const escritores = fuentes(join(RAIZ, 'src'))
      .concat(fuentes(join(RAIZ, 'server')))
      // Los tests quedan fuera: este mismo fichero nombra esas funciones para
      // poder buscarlas, y se encontraria a si mismo.
      .filter((p) => !relative(RAIZ, p).startsWith('src/tests/'))
      .filter((p) => {
        const src = readFileSync(p, 'utf8');
        return /writeFile|writeFileSync|createWriteStream/.test(src) && /src\/data|@\/data/.test(src);
      })
      .map((p) => relative(RAIZ, p));

    expect(escritores).toEqual([]);
  });
});

describe('integridad del corpus', () => {
  const casos = (corpus as { cases: Array<{ id: string; label: string; text: string }> }).cases;

  it('no hay ids repetidos', () => {
    // Dos casos con el mismo id dejan que uno tape al otro segun quien gane al
    // indexar. Es la forma mas barata de neutralizar un caso incomodo sin
    // borrarlo, y no se ve leyendo el diff.
    const vistos = new Map<string, number>();
    for (const c of casos) vistos.set(c.id, (vistos.get(c.id) ?? 0) + 1);
    expect([...vistos].filter(([, n]) => n > 1)).toEqual([]);
  });

  it('toda etiqueta pertenece al conjunto cerrado', () => {
    const validas = new Set(['SEGURO', 'SOSPECHOSO', 'PELIGROSO']);
    const invalidas = casos.filter((c) => !validas.has(c.label)).map((c) => `${c.id}:${c.label}`);
    expect(invalidas).toEqual([]);
  });

  it('ningun caso viene vacio', () => {
    expect(casos.filter((c) => !c.text || c.text.trim().length === 0)).toEqual([]);
  });

  it('el corpus declara version, para que una propuesta diga sobre que se midio', () => {
    expect((corpus as { version?: unknown }).version).toBeTruthy();
  });
});

describe('sin conversacion no hay ataque multi-turno', () => {
  it('lo que se manda a analizar no lleva historial de ningun tipo', () => {
    // Dos de las familias de inyeccion documentadas —el bypass cognitivo y el
    // prompting integrativo— necesitan varios turnos: llevan al modelo poco a
    // poco, o montan la instruccion entre mensajes. Aqui no hay donde: cada
    // analisis es una peticion suelta, sin memoria de la anterior. Que este
    // objeto siga sin tener un campo de historial ES la defensa.
    const peticion = buildAnalysisRequest('hola, como estas', 'text');

    expect(Object.keys(peticion).sort()).toEqual(['hardening', 'task', 'text']);
    expect(JSON.stringify(peticion)).not.toMatch(/history|messages|turns|conversation|previous/i);
  });

  it('dos analisis seguidos no comparten nada', () => {
    const a = buildAnalysisRequest('primer mensaje', 'text');
    const b = buildAnalysisRequest('segundo mensaje', 'text');

    expect(a.text).not.toBe(b.text);
    // Ni siquiera el marcador se repite: no hay un delimitador estable que
    // aprender a lo largo de varios mensajes.
    expect(a.hardening).not.toBe(b.hardening);
  });
});

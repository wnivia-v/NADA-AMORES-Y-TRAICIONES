// =============================================================================
// Vista previa del terminal de deliberacion
//
// Pinta el componente contra escenas fabricadas a mano y escribe un HTML suelto.
// Existe porque hay UI que no se puede juzgar leyendo el codigo: si tres paneles
// caben, si el indicio se lee, si la escena de "no contesto nadie" resulta
// clara o parece un error. Y porque las escenas interesantes —una IA capturada
// por una inyeccion, tres discrepando— no salen a peticion en la app real.
//
// Uso:  npx tsx bench/deliberation-preview.tsx
// =============================================================================

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { DeliberationTerminal } from '../src/components/analysis/DeliberationTerminal';
import type { Deliberation, ProviderRun } from '../src/shared/llm/deliberation';
import { findSuspicions } from '../src/shared/llm/deliberation';

function ok(id: string, name: string, value: number, ms: number, explanation: string, tactics: string[] = []): ProviderRun {
  return {
    id, name, outcome: 'answered', ms,
    signal: { type: 'llm-risk', value, confidence: 0.82, timestamp: 0, tactics, explanation, recommendations: [] },
  };
}

function acta(partial: Omit<Deliberation, 'suspicions'>): Deliberation {
  return { ...partial, suspicions: findSuspicions(partial.runs, partial.injectionIds.length > 0) };
}

const ESCENAS: Array<{ titulo: string; nota: string; d: Deliberation }> = [
  {
    titulo: 'Consenso de tres',
    nota: 'El caso que da credito al resultado: tres modelos independientes coinciden.',
    d: acta({
      strategy: 'consensus', totalMs: 812, winner: 'groq', injectionIds: [],
      runs: [
        ok('local', 'Clasificador local', 88, 41, 'Coincide con casos de romance con peticion de dinero.', ['romance-dinero']),
        ok('groq', 'Groq (Llama)', 91, 380, 'Urgencia, secreto y transferencia inmediata a un tercero.', ['urgencia', 'aislamiento']),
        ok('gemini', 'Google Gemini 2.0 Flash', 84, 812, 'Peticion economica tras vinculo afectivo breve.', ['romance-dinero']),
        { id: 'claude', name: 'Anthropic Claude', outcome: 'disabled', ms: null, signal: null, detail: 'apagado en ajustes' },
      ],
      reason: { kind: 'consensus', band: 'PELIGROSO', agreeing: ['local', 'groq', 'gemini'], dissenting: [], threshold: 2 },
    }),
  },
  {
    titulo: 'Una se aparta, y el texto traia inyeccion',
    nota: 'Lo que el jurado tiene que poder ver: la firma de una IA que pudo obedecer al atacante.',
    d: acta({
      strategy: 'consensus', totalMs: 640, winner: 'local', injectionIds: ['ignore-previous', 'role-override'],
      runs: [
        ok('local', 'Clasificador local', 92, 38, 'Vecino mas cercano: estafa de inversion con falso asesor.', ['inversion']),
        ok('groq', 'Groq (Llama)', 89, 410, 'Promesa de rentabilidad garantizada y presion temporal.', ['urgencia']),
        ok('gemini', 'Google Gemini 2.0 Flash', 3, 640, 'El mensaje parece una conversacion cordial sin riesgo.', []),
      ],
      reason: { kind: 'no-consensus', bands: ['PELIGROSO', 'SEGURO'] },
    }),
  },
  {
    titulo: 'Carrera: gana la que contesta antes',
    nota: 'Las otras siguen pensando. No es averia, es la carrera — y por eso se escribe.',
    d: acta({
      strategy: 'race', totalMs: 47, winner: 'local', injectionIds: [],
      runs: [
        ok('local', 'Clasificador local', 76, 44, 'Similitud alta con fraude de paqueteria.', ['suplantacion']),
        { id: 'groq', name: 'Groq (Llama)', outcome: 'still-running', ms: null, signal: null, detail: 'seguia pensando cuando Clasificador local contesto en 44 ms' },
        { id: 'gemini', name: 'Google Gemini 2.0 Flash', outcome: 'still-running', ms: null, signal: null, detail: 'seguia pensando cuando Clasificador local contesto en 44 ms' },
      ],
      reason: { kind: 'fastest', ms: 44, stillRunning: ['groq', 'gemini'] },
    }),
  },
  {
    titulo: 'Una rota y otra caida',
    nota: 'El motivo llega a pantalla en vez de morir en la consola.',
    d: acta({
      strategy: 'consensus', totalMs: 5030, winner: 'local', injectionIds: [],
      runs: [
        ok('local', 'Clasificador local', 64, 39, 'Parecido moderado con peticion de datos bancarios.', ['phishing']),
        { id: 'groq', name: 'Groq (Llama)', outcome: 'rejected', ms: 520, signal: null, rejection: 'not-json', detail: undefined },
        { id: 'gemini', name: 'Google Gemini 2.0 Flash', outcome: 'timeout', ms: 5000, signal: null, detail: 'sin respuesta en 5000 ms' },
      ],
      reason: { kind: 'sole-answer' },
    }),
  },
  {
    titulo: 'No contesto ninguna',
    nota: 'El veredicto sale entero del motor local. Sin esta vista, se leeria igual que un consenso.',
    d: acta({
      strategy: 'race', totalMs: 5010, winner: null, injectionIds: [],
      runs: [
        { id: 'local', name: 'Clasificador local', outcome: 'failed', ms: 120, signal: null, transport: 'model-init', detail: 'sin modelo de embeddings' },
        { id: 'groq', name: 'Groq (Llama)', outcome: 'failed', ms: 90, signal: null, transport: 'network', detail: 'TypeError' },
        { id: 'gemini', name: 'Google Gemini 2.0 Flash', outcome: 'unavailable', ms: null, signal: null, detail: 'habilitado pero sin configurar' },
      ],
      reason: { kind: 'silence' },
    }),
  },
];

// El CSS se compila con el Tailwind DEL PROYECTO, no con el CDN: sin eso la
// vista previa sale sin maquetar y no sirve para juzgar nada, que es justo lo
// unico para lo que existe. Ademas asi lo que se mira son las clases reales.
execFileSync('npx', ['tailwindcss', '-i', 'src/index.css', '-o', 'bench/.preview.css', '--minify'], {
  stdio: 'pipe',
  cwd: new URL('..', import.meta.url).pathname,
});
const css = readFileSync(new URL('./.preview.css', import.meta.url), 'utf8');

// El brief pide interfaz de tema doble, asi que la vista previa saca los dos.
// Un panel que se lee en claro y se pierde en oscuro es un panel a medio hacer.
const TEMA = process.argv[2] === 'gamer' ? 'theme-gamer' : 'theme-velvet';

const cuerpo = ESCENAS.map(({ titulo, nota, d }) => `
  <section style="margin-bottom:28px">
    <h2 style="font:700 13px/1.3 system-ui;color:var(--text-primary);margin:0 0 2px">${titulo}</h2>
    <p style="font:400 11px/1.4 system-ui;color:var(--text-muted);margin:0 0 8px">${nota}</p>
    ${renderToStaticMarkup(createElement(DeliberationTerminal, { deliberation: d }))}
  </section>`).join('\n');

const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>NADA — terminal de deliberacion</title>
<style>${css}</style>
<style>body{background:var(--bg-primary);padding:20px;font-family:var(--nada-font-sans)}</style>
</head><body class="${TEMA}">${cuerpo}</body></html>`;

const out = new URL(`./deliberation-preview.${TEMA === 'theme-gamer' ? 'gamer' : 'velvet'}.html`, import.meta.url);
writeFileSync(out, html);
console.log(`[NADA] ${out.pathname.split('/').pop()} — ${ESCENAS.length} escenas, tema ${TEMA}, ${Math.round(html.length / 1024)} kB`);

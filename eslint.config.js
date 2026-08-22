// =============================================================================
// Configuracion de ESLint
//
// Este archivo NO existia. El proyecto declaraba `npm run lint` desde el
// principio y nunca podia funcionar: ESLint 9 busca eslint.config.js, aqui no
// habia ninguna configuracion de ningun formato, y el script todavia usaba
// --ext, que la version 9 elimino. O sea que el linter llevaba todo el proyecto
// fallando con codigo 2 y pasando por "sin errores" para cualquiera que no
// mirase la salida.
//
// Lo encontro el hook de arranque al validarse, que es exactamente para lo que
// sirve validar un hook.
//
// La configuracion es deliberadamente corta. Un linter que avisa de doscientas
// cosas el primer dia se desactiva el segundo, asi que aqui solo estan las
// reglas que cazan errores de verdad; el formato lo decide quien escribe y los
// tipos ya los comprueba tsc, que es mejor en eso.
// =============================================================================

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  {
    // Generado o de terceros: nada que revisar.
    ignores: [
      'dist', 'build', 'server/dist', 'android', 'release*',
      'public/vision-worker.js', 'public/mediapipe',
      // Salida de compilacion: revisar lo generado no dice nada de lo escrito.
      'electron/*.cjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // TypeScript ya comprueba que existan los nombres, y lo hace mejor:
      // no-undef sobre TS marca `console`, `setTimeout` o `Buffer` como
      // indefinidos segun el bloque de globals que toque, que es ruido puro y
      // es lo que recomienda desactivar la propia documentacion de
      // typescript-eslint. Se apaga aqui, no se silencia archivo por archivo.
      'no-undef': 'off',

      // Un `any` a veces es la respuesta honesta —el tipo de MediaPipe, la
      // respuesta cruda de un proveedor— y ya hay tsc en modo estricto vigilando
      // lo que importa. Avisa, no bloquea.
      '@typescript-eslint/no-explicit-any': 'warn',

      // Los parametros que empiezan por _ estan sin usar A PROPOSITO, que es
      // como se documenta "aqui hay un argumento que no me hace falta".
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
  {
    // Scripts de Node sueltos (herramientas, hooks, preparacion del entorno).
    files: ['**/*.mjs', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      // globals@14 no trae los que Node 22 si tiene. Se declaran a mano en vez
      // de apagar no-undef aqui: en un script suelto, un nombre mal escrito no
      // lo caza nadie mas.
      globals: { ...globals.node, fetch: 'readonly', WebSocket: 'readonly', URL: 'readonly' },
    },
  },
  {
    // Los caracteres de control DENTRO de estas expresiones son el objetivo,
    // no un descuido: son justo lo que se busca y se quita del texto.
    files: ['src/shared/llm/normalize.ts', 'src/utils/scamPatterns.ts'],
    rules: { 'no-control-regex': 'off' },
  },
  {
    // Los tests fingen mucho, y fingir bien a veces necesita tipos flojos.
    files: ['src/tests/**/*.ts', 'bench/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      // Un doble de prueba que se guarda a si mismo en una variable
      // (`constructor() { live = this }`) es el patron normal para poder
      // inspeccionar la instancia que creo el codigo bajo prueba.
      '@typescript-eslint/no-this-alias': 'off',
    },
  },
);

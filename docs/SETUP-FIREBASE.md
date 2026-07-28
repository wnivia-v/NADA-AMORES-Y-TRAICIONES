# Configurar Firebase (Gemini) — Gratis, sin tarjeta

NADA usa Firebase AI Logic para acceder a Gemini 2.0 Flash. El tier gratuito
funciona **siempre que el proyecto NO tenga facturacion vinculada** (plan Spark).

Tiempo estimado: 5 minutos.

---

## Paso 1: Crear el proyecto

1. Abre [console.firebase.google.com](https://console.firebase.google.com)
2. Haz clic en **Agregar proyecto** (o "Add project")
3. Nombre: lo que quieras (ejemplo: `nada-shield`)
4. Google Analytics: desactívalo, no lo necesitas
5. Haz clic en **Crear proyecto** y espera ~30 segundos

---

## Paso 2: Activar Firebase AI Logic

1. En el panel izquierdo busca **AI Logic** (o "Genkit" en algunos idiomas)
   - Si no aparece: ve a **Build > AI Logic** o busca "Gemini" en el buscador
2. Cuando pregunte qué API usar, elige **Gemini Developer API** (NO Vertex AI)
3. Acepta los términos

> **IMPORTANTE:** NO actives facturacion (billing). Si te lo pide, elige
> "Continuar sin facturacion" o "Stay on Spark plan". En el momento en que
> vinculas una tarjeta, sales del tier gratuito.

---

## Paso 3: Registrar la app web

1. En la pantalla principal del proyecto, haz clic en el icono **</>** (Web)
2. Nombre: `NADA` (solo es para identificarla)
3. NO marques Firebase Hosting
4. Haz clic en **Registrar app**
5. Te mostrara un bloque de configuracion como este:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "nada-shield.firebaseapp.com",
  projectId: "nada-shield",
  storageBucket: "nada-shield.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

---

## Paso 4: Copiar las variables

Crea el archivo `.env.local` en la raiz del proyecto (junto a `package.json`):

```env
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=nada-shield.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=nada-shield
VITE_FIREBASE_STORAGE_BUCKET=nada-shield.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abc123
```

Usa los valores de TU proyecto, no los del ejemplo.

---

## Paso 5: Verificar

```bash
npm run dev
```

Abre la app, pega un texto sospechoso y analízalo. En la consola del navegador
(F12) debería aparecer `[NADA] Gemini model` si se conecta correctamente, y el
resultado mostrará `Motor: hybrid` en vez de `Motor: local`.

---

## Limites del tier gratuito

- ~15 peticiones por minuto (NADA usa 14 como máximo configurado)
- ~1500 peticiones por día (varía por modelo y región)
- Sin fecha de expiración: es permanente mientras no vincules facturación

Si ves errores 429 en la consola, los escudos de fondo están consumiendo la
cuota. NADA ya tiene un limitador que lo previene, pero si ocurre, simplemente
espera un minuto.

---

## Desactivar / cambiar

Para volver al modo solo-local, borra o vacía las variables en `.env.local` y
reinicia el servidor de desarrollo. NADA detecta que no hay credenciales y usa
solo el proveedor local + regex.

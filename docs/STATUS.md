# Estado del Proyecto NADA — Checklist de Verificacion

> Ultima actualizacion: 28 Julio 2026  
> Marcar con [x] a medida que se verifique o complete.

---

## 1. Funciona (verificado)

- [x] TypeScript app compila sin errores
- [x] TypeScript Electron compila y emite `main.cjs` + `preload.cjs`
- [x] 103 tests pasan (Vitest)
- [x] Build web/PWA exitoso
- [x] Instalador Windows generado (78 MB)
- [x] Instalador arranca y carga el renderer
- [x] Proveedor local medido: 87.5% precision, 100% recall, 0% falsas alarmas
- [x] CI en GitHub Actions (no requiere secretos)
- [x] Repositorio subido a `github.com/wnivia-v/NADA-AMORES-Y-TRAICIONES`
- [x] Limitador de cuota implementado y testeado
- [x] Escudos no se cancelan entre si (AbortController por carril)
- [x] Contadores no duplican
- [x] OCR serializado
- [x] Icono PNG generado
- [x] Firebase Spark configurado (proyecto `nada-shield`)
- [x] App Check con reCAPTCHA Enterprise configurado
- [x] Gemini AI respondiendo (pipeline hybrid verificado en vivo)
- [x] Clipboard shield detecto texto de extorsion automaticamente (86/100)
- [x] Internacionalizacion completa (todos los strings en translations.ts)
- [x] Chunk splitting (Transformers.js, Firebase, MediaPipe separados)
- [x] Accesibilidad: focus rings, aria labels, touch targets 44px, keyboard nav, semantic buttons
- [x] Patrones regex corregidos (envies, vocabulario regional, word boundaries)
- [x] Sanitizacion anti-prompt-injection en español (5 patrones)
- [x] Corpus ampliado con 11 casos reales de INCIBE
- [x] Proveedor Groq implementado (tier gratuito)
- [x] Proveedor local implementado (Transformers.js kNN)
- [x] Rate limiter para cuotas de tier gratuito
- [x] Docs: STATUS.md, SETUP-FIREBASE.md, SETUP-GROQ.md
- [x] Paleta de colores pastel claro + gamer neon oscuro

---

## 2. Necesita verificacion manual (tu lo pruebas)

- [x] Clipboard shield detecta y alerta al copiar texto de estafa
- [ ] Proveedor local funciona en Chrome/Electron (descarga ~120 MB en primer uso)
- [ ] OCR extrae texto de una captura real (sube imagen de WhatsApp al analizador)
- [ ] Icono del tray visible en la barra de Windows (instala el .exe)
- [ ] Voice analyzer graba, transcribe y analiza en tiempo real
- [ ] Camera analyzer detecta rostro
- [ ] Push notifications aparecen al detectar amenaza
- [ ] Onboarding se muestra solo la primera vez
- [ ] Exportar CSV descarga un archivo valido (Alertas > CSV)
- [ ] Compartir alerta funciona
- [ ] ThreatChart muestra barras despues de varios escaneos
- [ ] El modo ingles muestra todos los textos correctamente

---

## 3. Pendiente — Requiere tu accion

- [ ] **Groq (opcional)**: crear cuenta en [console.groq.com](https://console.groq.com), copiar API key a `.env.local` (ver `docs/SETUP-GROQ.md`) — 2 min, gratis, sin tarjeta
- [ ] **Probar la app manualmente** — las pruebas del punto 2
- [ ] **Agregar estafas reales al corpus** (`src/data/scam-corpus.json`) — cada mensaje real mejora la deteccion
- [ ] Firmar el instalador — solo si vas a distribuir publicamente (~$80-300/año)
- [ ] Mover clave de Claude detras de un backend — solo si vas a desplegar la PWA publicamente
- [ ] Desplegar la PWA (Firebase Hosting / Vercel / otro) — cuando estes listo

---

## 4. Disponible pero no activado

- **Bedrock (AWS)**: el codigo del proveedor existe pero requiere un proxy propio (API Gateway + Lambda con firma SigV4). Se deja por si se necesita en el futuro. No funciona sin ese proxy.
- **Claude**: el codigo existe pero es de pago y la API key viaja en el bundle del cliente. No activar en despliegues publicos sin un backend intermedio.

---

## 5. No queda nada pendiente para el agente

Todas las tareas que se podian hacer sin supervision estan completadas:
- Internacionalizacion ✅
- Accesibilidad ✅  
- Chunk splitting ✅
- Regex patterns ✅
- Sanitizacion ✅
- Corpus ✅
- Documentacion ✅
- Rate limiter ✅
- Proveedores gratuitos ✅

---

## 6. No recomendado

- Añadir mas proveedores de IA (5 implementados es suficiente)
- Reescribir la arquitectura (funciona, tiene 103 tests y mediciones)
- Desplegar publicamente sin resolver la clave de Claude en el bundle
- Pagar por algo: todo funciona gratis

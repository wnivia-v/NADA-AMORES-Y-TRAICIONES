# Estado del Proyecto NADA — Checklist de Verificacion

> Ultima actualizacion: 28 Julio 2026  
> Marcar con [x] a medida que se verifique o complete.

---

## 1. Funciona (verificado por herramientas)

- [x] TypeScript app compila sin errores
- [x] TypeScript Electron compila y emite `main.cjs` + `preload.cjs`
- [x] 103 tests pasan (Vitest)
- [x] Build web/PWA exitoso (`vite build`, precache 1.37 MB)
- [x] Instalador Windows generado (`NADA-Shield-2.0.0-Setup.exe`, 78 MB)
- [x] Instalador arranca y carga el renderer (verificado por proceso)
- [x] Proveedor local medido: 87.5% precision, 100% recall, 0% falsas alarmas
- [x] CI en GitHub Actions (no requiere secretos)
- [x] Repositorio subido a `github.com/wnivia-v/NADA-AMORES-Y-TRAICIONES`
- [x] Limitador de cuota implementado y testeado
- [x] Escudos no se cancelan entre si (AbortController por carril)
- [x] Contadores no duplican (addAlert + setAnalysisResult = 1 cuenta)
- [x] OCR serializado (un solo recognize() a la vez)
- [x] Icono PNG generado (512x512, build/icon.png y public/icon.png)
- [x] Firebase Spark configurado (proyecto `nada-shield`)
- [x] App Check con reCAPTCHA Enterprise configurado
- [x] Gemini AI respondiendo (pipeline hybrid verificado en vivo)
- [x] Clipboard shield detecto texto de extorsion automaticamente (86/100 PELIGROSO)

---

## 2. Necesita verificacion manual (tu lo pruebas)

- [x] Clipboard shield detecta y alerta al copiar texto de estafa (**VERIFICADO** — detecto extorsion 86/100)
- [ ] Proveedor local funciona en Chrome/Electron real (descarga modelo ~120 MB en primer uso)
- [ ] OCR extrae texto de una captura real (sube una imagen de WhatsApp al analizador de imagenes)
- [ ] Icono del tray visible en la barra de Windows (instala el .exe y mira abajo a la derecha)
- [ ] Voice analyzer graba, transcribe y analiza en tiempo real
- [ ] Camera analyzer detecta rostro y mide biometria
- [ ] Push notifications aparecen al detectar amenaza
- [ ] Onboarding se muestra solo la primera vez (borra localStorage y recarga)
- [ ] Exportar CSV descarga un archivo valido (Alertas > boton CSV)
- [ ] Compartir alerta abre el dialogo del sistema
- [ ] ThreatChart muestra barras despues de varios escaneos
- [ ] El modo ingles muestra todos los textos correctamente

---

## 3. Completado por el agente (ya no pendiente)

- [x] Corregir patrones regex (envies 14->44, vocabulario regional 14->44, visa/pin word boundary)
- [x] Medir precision/recall de la capa regex contra el corpus (`bench/measure-regex.ts`)
- [x] Sanitizacion anti-prompt-injection en español (5 patrones nuevos)
- [x] Corpus ampliado con 11 casos reales de INCIBE (smishing bancario ES)
- [x] Proveedor Groq implementado (tier gratuito, sin tarjeta)
- [x] Proveedor local implementado (Transformers.js, embeddings kNN)
- [x] Rate limiter para cuotas de tier gratuito
- [x] Documentacion: STATUS.md, SETUP-FIREBASE.md, SETUP-GROQ.md
- [x] Paleta de colores actualizada (pastel claro + gamer neon oscuro)

---

## 4. Pendiente — El agente puede hacerlo (sin tu supervision)

- [ ] Internacionalizacion: mover strings hardcodeados restantes a `translations.ts`
- [ ] Accesibilidad: contraste, touch targets, keyboard, aria, reduced-motion
- [ ] Reducir tamaño del chunk de Transformers.js con `manualChunks`

---

## 5. Pendiente — Requiere tu accion

- [ ] **Crear cuenta Groq** y poner la clave en `.env.local` (ver `docs/SETUP-GROQ.md`) — 2 min, gratis
- [ ] **Probar la app manualmente** — las pruebas del punto 2
- [ ] **Decidir si quitar Bedrock** de la UI (no funciona sin un proxy que hay que construir)
- [ ] **Agregar estafas reales al corpus** — cada mensaje real que consigas mejora la deteccion
- [ ] Firmar el instalador (certificado ~$80-300/año) — solo si vas a distribuir publicamente
- [ ] Mover clave de Claude detras de un backend — solo si vas a desplegar la PWA publicamente
- [ ] Desplegar la PWA (Firebase Hosting / Vercel / otro)

---

## 6. No recomendado

- Añadir mas proveedores de IA (5 es suficiente)
- Reescribir la arquitectura (funciona, tiene tests y mediciones)
- Desplegar publicamente sin resolver la clave de Claude en el bundle
- Pagar por algo: todo funciona gratis ahora mismo

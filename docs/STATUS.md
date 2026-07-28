# Estado del Proyecto NADA — Checklist de Verificacion

> Ultima actualizacion: 28 Julio 2026  
> Marcar con [x] a medida que se verifique o complete.

---

## 1. Funciona (verificado por herramientas)

- [x] TypeScript app compila sin errores (`npx tsc --noEmit`)
- [x] TypeScript Electron compila y emite `main.cjs` + `preload.cjs`
- [x] 98 tests pasan (Vitest)
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

---

## 2. Existe pero necesita verificacion manual

- [ ] Proveedor local funciona en Chrome/Electron real (descarga modelo ~120 MB)
- [ ] OCR extrae texto de una captura real dentro del `.exe`
- [ ] Icono del tray visible en la barra de Windows
- [ ] Clipboard shield detecta y alerta al copiar texto de estafa
- [ ] Voice analyzer graba, transcribe y analiza en tiempo real
- [ ] Camera analyzer detecta rostro y mide biometria
- [ ] Push notifications aparecen al detectar amenaza
- [ ] Onboarding se muestra solo la primera vez
- [ ] Exportar CSV descarga un archivo valido
- [ ] Compartir alerta abre el dialogo del sistema o copia al portapapeles
- [ ] ThreatChart muestra barras despues de varios escaneos
- [ ] El modo ingles muestra todos los textos correctamente

---

## 3. Pendiente — Sin dependencias externas (el agente puede hacerlo)

- [ ] Corregir patrones regex que fallan en el corpus (caso `envies` y similares)
- [ ] Medir precision/recall de la capa regex contra el corpus
- [ ] Auditoria de seguridad: intentar romper `sanitizeForPrompt` en español
- [ ] Internacionalizacion: mover strings hardcodeados a `translations.ts`
- [ ] Accesibilidad: contraste, touch targets, keyboard, aria, reduced-motion
- [ ] Reducir tamaño del chunk transformers.js con `manualChunks`
- [ ] Limpiar `npm audit` (solo lo alcanzable sin romper dependencias)

---

## 4. Pendiente — Requiere accion del usuario

- [ ] Crear proyecto Firebase Spark y configurar `.env.local` (ver `docs/SETUP-FIREBASE.md`)
- [ ] Crear cuenta Groq y configurar `.env.local` (ver `docs/SETUP-GROQ.md`)
- [ ] Medir Gemini y Groq contra el corpus una vez configurados
- [ ] Probar la app manualmente (instalar .exe, copiar texto, subir imagen, etc.)
- [ ] Decidir si mantener o eliminar Bedrock de la UI
- [ ] Firmar el instalador (certificado ~$80-300/año)
- [ ] Mover clave de Claude detras de un backend antes de desplegar publicamente
- [ ] Desplegar la PWA (Firebase Hosting / Vercel / otro)
- [ ] Agregar estafas reales al corpus (`src/data/scam-corpus.json`)

---

## 5. No recomendado

- Añadir mas proveedores de IA (5 es suficiente, medir los existentes primero)
- Reescribir la arquitectura (funciona, tiene tests y mediciones)
- Desplegar publicamente sin resolver la clave de Claude en el bundle y la firma del instalador

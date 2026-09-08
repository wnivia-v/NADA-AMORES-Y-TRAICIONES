# Código

El código vive en su propio repositorio, no copiado aquí:

**https://github.com/wnivia-v/NADA-AMORES-Y-TRAICIONES**

Duplicar unas veinte mil líneas dentro del repositorio de la cohorte dejaría dos
copias que se separan a la primera corrección, y la que se mira en la evaluación
sería la vieja. El enlace siempre apunta a la de verdad, y la guía oficial pide
justamente eso: «Enlace a su repositorio personal de GitHub».

    git clone https://github.com/wnivia-v/NADA-AMORES-Y-TRAICIONES
    cd NADA-AMORES-Y-TRAICIONES
    npm ci
    npm run dev        # la app, sin claves ni cuenta
    npm test           # 490 tests
    npm run bench:redteam        # banco adversario de inyección
    npx tsx bench/measure-regex.ts   # detección sobre el corpus etiquetado

## Por dónde empezar a leerlo

| Qué | Dónde |
|---|---|
| Léxico de amenazas: patrones, combinaciones y amortiguadores | `src/utils/threatLexicon.ts` |
| Puntuación local, sin red | `src/utils/scamPatterns.ts` |
| Diccionario con conjugaciones y términos ambiguos | `src/utils/threatDictionary.ts` |
| Fusión de señales y ventana deslizante — **aquí se decide** | `src/shared/risk/fusionEngine.ts` |
| Blindaje del turno del LLM y escaneo de inyección | `src/shared/llm/` |
| Visión on-device en Web Worker | `src/shared/vision/`, `src/workers/vision.worker.ts` |
| Motor del escudo (voz, vídeo, orquestación) | `src/services/protectionEngine.ts` |
| Backend: proxy de IA, consentimiento y reportes | `server/src/` |
| Protocolo de seguridad, mapeado a MITRE ATLAS y NIST AI RMF | `docs/PROTOCOLO-SEGURIDAD.md` |
| Bancos de medida | `bench/` |

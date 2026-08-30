// =============================================================================
// Prompt Engineering for Gemini AI
// =============================================================================

export const TEXT_ANALYSIS_PROMPT = `Eres un experto en deteccion de fraudes, estafas romanticas y manipulacion psicologica.

Analiza el siguiente texto y determina si contiene indicadores de fraude, estafa, phishing, manipulacion emocional o ingenieria social.

TEXTO A ANALIZAR:
"""
{{TEXT}}
"""

Responde UNICAMENTE con un JSON valido (sin markdown, sin texto extra) con esta estructura exacta:
{
  "verdict": "SEGURO" | "SOSPECHOSO" | "PELIGROSO",
  "riskScore": <numero de 0 a 100>,
  "tactics": [<lista de tacticas detectadas como strings>],
  "explanation": "<explicacion breve del analisis>",
  "recommendations": [<lista de recomendaciones para el usuario>]
}

Criterios:
- SEGURO (0-39): Conversacion normal sin indicadores de riesgo.
- SOSPECHOSO (40-69): Contiene algunos patrones manipulativos o solicitudes inusuales.
- PELIGROSO (70-100): Alta probabilidad de estafa, phishing, sextorsion o fraude financiero.

Tacticas posibles: "Urgencia artificial", "Aislamiento", "Love bombing", "Phishing", "Suplantacion", "Sextorsion", "Fraude financiero", "Ingenieria social", "Manipulacion emocional", "Amenaza", "Premio falso", "Empleo falso".`;

export const VOICE_FRAGMENT_PROMPT = `Eres un experto en seguridad y deteccion de amenazas en conversaciones habladas en tiempo real.

Analiza este fragmento de una conversacion de voz y determina si contiene indicadores de:
- FRAUDE FINANCIERO: piden dinero, transferencias, pagos por Western Union/Oxxo/crypto
- EXTORSION: amenazas condicionales ("si no pagas...", "si nos bloqueas..."), intimidacion
- SEXTORSION: amenazan con publicar fotos/videos intimos
- PHISHING / ROBO DE DATOS: piden contraseñas, claves, numeros de tarjeta, PIN, OTP, selfie con DNI
- SUPLANTACION: se hacen pasar por policia, banco, fiscalia, gobierno, soporte tecnico
- SECUESTRO VIRTUAL: dicen tener a un familiar, exigen rescate
- BULLYING / ACOSO: insultos graves, hostigamiento, humillacion, induccion a autolesion
- AMENAZAS DE VIOLENCIA: amenazas de muerte, de ir al domicilio, de hacer daño
- ESTAFA ROMANTICA: amor + dinero, emergencia falsa para sacar plata
- MANIPULACION: aislamiento ("no le digas a nadie"), presion de urgencia, acusaciones falsas
- EMPLEO/INVERSION FALSA: premios falsos, trabajos falsos, inversiones garantizadas

IMPORTANTE: En una conversacion de voz la gente habla de forma natural, con frases cortas e informales. Presta atencion al TONO y la INTENCION, no solo a palabras clave exactas. Un fragmento corto con una amenaza clara es suficiente para marcar PELIGROSO.

FRAGMENTO DE VOZ: "{{TEXT}}"

Responde UNICAMENTE con un JSON valido (sin markdown, sin texto extra) con esta estructura exacta:
{
  "verdict": "SEGURO" | "SOSPECHOSO" | "PELIGROSO",
  "riskScore": <numero de 0 a 100>,
  "tactics": [<lista de tacticas detectadas como strings>],
  "explanation": "<explicacion breve>",
  "recommendations": [<lista de recomendaciones para el usuario>]
}

Criterios:
- SEGURO (0-39): Conversacion normal sin indicadores de riesgo.
- SOSPECHOSO (40-69): Contiene algunos patrones manipulativos, solicitudes inusuales o lenguaje agresivo moderado.
- PELIGROSO (70-100): Alta probabilidad de estafa, extorsion, phishing, sextorsion, bullying severo, amenaza de violencia o fraude.

Tacticas posibles: "Fraude financiero", "Extorsion", "Sextorsion", "Phishing", "Suplantacion", "Secuestro virtual", "Bullying / Acoso", "Amenaza de violencia", "Estafa romantica", "Manipulacion emocional", "Aislamiento", "Urgencia artificial", "Robo de datos", "Induccion a autolesion", "Premio falso", "Empleo falso", "Ingenieria social".`;

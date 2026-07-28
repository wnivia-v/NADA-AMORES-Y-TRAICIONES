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

export const VOICE_FRAGMENT_PROMPT = `Analiza este fragmento de una conversacion en tiempo real. Detecta indicadores de estafa o manipulacion:

FRAGMENTO: "{{TEXT}}"

Responde SOLO JSON:
{
  "verdict": "SEGURO" | "SOSPECHOSO" | "PELIGROSO",
  "riskScore": <0-100>,
  "tactics": [],
  "explanation": ""
}`;

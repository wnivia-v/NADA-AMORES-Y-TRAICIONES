# Configurar Groq — Gratis, sin tarjeta

Groq ofrece un tier gratuito permanente con modelos Llama de Meta. No pide
tarjeta de crédito ni tiene periodo de prueba que expire.

Tiempo estimado: 2 minutos.

---

## Paso 1: Crear la cuenta

1. Abre [console.groq.com](https://console.groq.com)
2. Haz clic en **Sign Up**
3. Puedes registrarte con Google, GitHub o email
4. NO te pedirá tarjeta de crédito

---

## Paso 2: Crear una API Key

1. Una vez dentro, ve a **API Keys** en el menú izquierdo
   (o directo: [console.groq.com/keys](https://console.groq.com/keys))
2. Haz clic en **Create API Key**
3. Nombre: `nada` (es solo para identificarla)
4. Copia la clave que aparece — **solo se muestra una vez**

La clave tiene esta forma: `gsk_xxxxxxxxxxxxxxxxxxxxxxxxx`

---

## Paso 3: Añadir al proyecto

Abre (o crea) el archivo `.env.local` en la raíz del proyecto:

```env
VITE_GROQ_API_KEY=gsk_tu_clave_aqui
```

Si ya tienes variables de Firebase ahí, simplemente añade esta línea al final.

---

## Paso 4: Verificar

```bash
npm run dev
```

Abre la app → Ajustes → Proveedores de IA. Groq debería mostrar "API
configurada" en verde. Analiza un texto y verifica que el resultado diga
`Motor: hybrid`.

---

## Limites del tier gratuito

| Modelo | Peticiones/minuto | Peticiones/día | Tokens/minuto |
|--------|:-:|:-:|:-:|
| llama-3.3-70b-versatile | 30 | 1,000 | 12,000 |
| llama-3.1-8b-instant | 30 | 14,400 | 20,000 |

NADA usa `llama-3.3-70b-versatile` por defecto (mejor calidad). Si quieres el
más rápido a cambio de menos precisión:

```env
VITE_GROQ_MODEL=llama-3.1-8b-instant
```

Los límites se verifican en [console.groq.com/settings/limits](https://console.groq.com/settings/limits) — cambian ocasionalmente.

---

## Cómo funciona con los otros proveedores

Con la estrategia **Fallback** (la predeterminada), NADA intenta los proveedores
en orden de prioridad:

1. **Local** (siempre disponible, sin red)
2. **Gemini** (si configuraste Firebase)
3. **Groq** (si configuraste la clave)

Si el proveedor local responde con confianza, ni Gemini ni Groq se llaman. Si
el local declina (no está seguro), pasa a Gemini. Si Gemini agota su cuota o
falla, pasa a Groq. Así se maximiza la detección sin desperdiciar cuota.

---

## Desactivar

Borra la línea `VITE_GROQ_API_KEY` de `.env.local` o ve a Ajustes y pon Groq
en OFF.

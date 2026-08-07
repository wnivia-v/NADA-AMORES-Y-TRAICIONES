// =============================================================================
// OCR Service — Tesseract.js v5 (Lazy-loaded)
// Extracts text from screen captures for scam detection
//
// A Tesseract worker handles exactly one recognize() at a time. The screen
// shield and ImageAnalyzer can both reach this module concurrently, and calling
// recognize() twice in parallel on one worker corrupts or drops a result. All
// jobs are therefore serialized through a single promise chain.
// =============================================================================

type TesseractWorker = {
  recognize: (input: unknown) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<void>;
};

let worker: TesseractWorker | null = null;
let workerInit: Promise<TesseractWorker | null> | null = null;

// Tail of the job queue. Each new job awaits the previous one.
let queue: Promise<unknown> = Promise.resolve();

async function getWorker(): Promise<TesseractWorker | null> {
  if (worker) return worker;

  // Concurrent first-callers must share one initialization, not start several.
  if (!workerInit) {
    workerInit = (async () => {
      try {
        const Tesseract = await import('tesseract.js');
        // Use both Spanish + English for better results on mixed-language screenshots
        worker = (await Tesseract.createWorker(['spa', 'eng'] as any)) as unknown as TesseractWorker;
        return worker;
      } catch (e) {
        console.warn('[NADA] OCR worker init failed:', e);
        workerInit = null; // allow a later retry
        return null;
      }
    })();
  }

  return workerInit;
}

/** Serializes an OCR job onto the shared worker. */
function enqueue<T>(job: () => Promise<T>, fallback: T): Promise<T> {
  const run = queue.then(job, job).catch(() => fallback);
  // Keep the chain alive regardless of individual job outcomes.
  queue = run.catch(() => undefined);
  return run;
}

// ── Preprocessing ─────────────────────────────────────────────────────────
//
// Phone screenshots of chat apps are the worst case for OCR run with no
// preprocessing: small text, low contrast (white/dark text on colored
// bubbles), and — for real phone photos of a screen rather than a native
// screenshot — compression noise. Feeding Tesseract the raw image made it
// report those as unreadable ("blurry") even when the source was sharp,
// because glyph edges at that size and contrast are genuinely hard to
// segment. Upscaling + grayscale + contrast stretch is the standard fix and
// costs one extra canvas pass.

// Data URLs are already fully in-memory (no network fetch), so decode is
// normally near-instant. The timeout is a safety net for environments with no
// real image decoder (e.g. jsdom in tests) where onload/onerror may never
// fire at all — without it a bad input would hang instead of falling back.
const IMAGE_LOAD_TIMEOUT_MS = 300;

async function loadToCanvas(input: HTMLCanvasElement | string): Promise<HTMLCanvasElement> {
  if (input instanceof HTMLCanvasElement) return input;

  const img = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('image-load-failed'));
  });
  img.src = input;
  await Promise.race([
    loaded,
    new Promise<void>((_, reject) => setTimeout(() => reject(new Error('image-load-timeout')), IMAGE_LOAD_TIMEOUT_MS)),
  ]);

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx?.drawImage(img, 0, 0);
  return canvas;
}

/** Upscales small screenshots and grayscale+contrast-stretches for sharper glyph edges. */
function preprocess(source: HTMLCanvasElement): HTMLCanvasElement {
  // Small screenshots (phones scaled down for a preview, or genuinely
  // low-res) benefit the most — bigger glyphs give Tesseract more pixels per
  // character to work with.
  const scale = source.width < 1200 ? 2 : 1;
  const out = document.createElement('canvas');
  out.width = source.width * scale;
  out.height = source.height * scale;

  const ctx = out.getContext('2d');
  if (!ctx) return source;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, out.width, out.height);

  const imageData = ctx.getImageData(0, 0, out.width, out.height);
  const data = imageData.data;
  const CONTRAST = 1.35; // pulls midtones toward black/white without clipping detail
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const gray = r * 0.299 + g * 0.587 + b * 0.114;
    const contrasted = Math.min(255, Math.max(0, (gray - 128) * CONTRAST + 128));
    data[i] = contrasted;
    data[i + 1] = contrasted;
    data[i + 2] = contrasted;
  }
  ctx.putImageData(imageData, 0, 0);
  return out;
}

async function recognize(input: HTMLCanvasElement | string): Promise<string> {
  const w = await getWorker();
  if (!w) return '';

  // Preprocessing is a best-effort quality boost, not a requirement — if
  // decoding fails (corrupt data, or an environment with no real image
  // decoder) fall back to handing Tesseract the original input rather than
  // losing the OCR pass entirely.
  let toRecognize: unknown = input;
  try {
    toRecognize = preprocess(await loadToCanvas(input));
  } catch {
    toRecognize = input;
  }

  try {
    const { data } = await w.recognize(toRecognize);
    return data.text.trim();
  } catch {
    return '';
  }
}

export function extractTextFromCanvas(canvas: HTMLCanvasElement): Promise<string> {
  return enqueue(() => recognize(canvas), '');
}

export function extractTextFromImage(imageUrl: string): Promise<string> {
  return enqueue(() => recognize(imageUrl), '');
}

export async function terminateOCR(): Promise<void> {
  // Wait for in-flight work so we never terminate mid-recognition.
  await queue.catch(() => undefined);
  if (worker) {
    try {
      await worker.terminate();
    } catch {
      // Worker already gone
    }
    worker = null;
    workerInit = null;
  }
}

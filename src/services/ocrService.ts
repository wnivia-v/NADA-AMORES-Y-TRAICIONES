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
        worker = (await Tesseract.createWorker(['spa', 'eng'])) as unknown as TesseractWorker;
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

async function recognize(input: unknown): Promise<string> {
  const w = await getWorker();
  if (!w) return '';

  try {
    const { data } = await w.recognize(input);
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

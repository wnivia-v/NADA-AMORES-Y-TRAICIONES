import { describe, it, expect, vi, beforeEach } from 'vitest';

// Instrumented Tesseract worker that records how many recognize() calls are
// in flight at once, and how many workers were ever created.
let active = 0;
let maxConcurrent = 0;
let createWorkerCalls = 0;

vi.mock('tesseract.js', () => ({
  createWorker: vi.fn(async () => {
    createWorkerCalls++;
    await new Promise((r) => setTimeout(r, 10));
    return {
      recognize: async () => {
        active++;
        maxConcurrent = Math.max(maxConcurrent, active);
        await new Promise((r) => setTimeout(r, 15));
        active--;
        return { data: { text: '  texto reconocido  ' } };
      },
      terminate: async () => undefined,
    };
  }),
}));

import { extractTextFromImage, extractTextFromCanvas, terminateOCR } from '@/services/ocrService';

/**
 * A Tesseract worker handles one recognize() at a time. The screen shield and
 * ImageAnalyzer can both reach this module concurrently, so jobs must be
 * serialized and the worker must be created only once.
 */
describe('ocrService concurrency', () => {
  beforeEach(async () => {
    await terminateOCR();
    active = 0;
    maxConcurrent = 0;
    createWorkerCalls = 0;
  });

  it('serializes concurrent OCR jobs onto the single worker', async () => {
    const results = await Promise.all([
      extractTextFromImage('data:image/png;base64,a'),
      extractTextFromImage('data:image/png;base64,b'),
      extractTextFromImage('data:image/png;base64,c'),
      extractTextFromCanvas({} as HTMLCanvasElement),
    ]);

    expect(results).toHaveLength(4);
    expect(maxConcurrent).toBe(1);
  });

  it('creates the worker once even when callers race for it', async () => {
    await Promise.all([
      extractTextFromImage('data:image/png;base64,a'),
      extractTextFromImage('data:image/png;base64,b'),
      extractTextFromImage('data:image/png;base64,c'),
    ]);

    expect(createWorkerCalls).toBe(1);
  });

  it('trims the recognized text', async () => {
    const text = await extractTextFromImage('data:image/png;base64,a');
    expect(text).toBe('texto reconocido');
  });

  it('keeps serving jobs after one fails', async () => {
    const failing = extractTextFromImage(null as unknown as string);
    const following = extractTextFromImage('data:image/png;base64,b');

    await expect(failing).resolves.toBeTypeOf('string');
    await expect(following).resolves.toBe('texto reconocido');
  });
});

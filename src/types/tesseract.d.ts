declare module 'tesseract.js' {
  export function createWorker(lang: string): Promise<{
    recognize: (image: HTMLCanvasElement | string) => Promise<{ data: { text: string } }>;
    terminate: () => Promise<void>;
  }>;
}

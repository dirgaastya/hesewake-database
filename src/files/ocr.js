import { mkdirSync } from 'node:fs';

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`OCR lebih dari ${Math.round(ms / 1000)} detik`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// Satu worker tesseract dipakai ulang dan antrean dijalankan berurutan supaya RAM tidak membengkak saat impor massal.
// Data bahasa diunduh sekali ke cacheDir; setelah itu OCR jalan offline.
export function createOcr({ cacheDir, langs = ['ind', 'eng'], timeoutMs = 60_000, createWorker } = {}) {
  let workerPromise = null;
  let queue = Promise.resolve();

  async function getWorker() {
    if (!workerPromise) {
      workerPromise = (async () => {
        const create = createWorker ?? (await import('tesseract.js')).createWorker;
        if (cacheDir) mkdirSync(cacheDir, { recursive: true });
        return create(langs, 1, { cachePath: cacheDir, logger: () => {}, errorHandler: () => {} });
      })().catch((err) => {
        workerPromise = null;
        throw err;
      });
    }
    return workerPromise;
  }

  async function reset() {
    const pending = workerPromise;
    workerPromise = null;
    const worker = await pending?.catch(() => null);
    await worker?.terminate().catch(() => {});
  }

  function recognize(buffer) {
    const job = queue.then(async () => {
      const worker = await getWorker();
      try {
        const { data } = await withTimeout(worker.recognize(buffer), timeoutMs);
        return data.text.replace(/[ \t]+\n/g, '\n').trim();
      } catch (err) {
        // Worker yang macet dibuang supaya job berikutnya mulai bersih.
        await reset();
        throw err;
      }
    });
    queue = job.catch(() => {});
    return job;
  }

  return { recognize, terminate: reset };
}

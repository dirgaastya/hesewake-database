import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

const destroyed = [];

// Bentuk objek meniru pdf.js v6: dokumen TIDAK punya destroy(), hanya loading task.
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  TextLayer: class {
    render() {
      return Promise.resolve();
    }
    cancel() {}
  },
  getDocument: ({ url }) => {
    const doc = {
      numPages: 2,
      getPage: async () => ({
        getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale, scale }),
        getTextContent: async () => ({ items: [{ str: 'Surat keputusan bed AHJT' }] }),
      }),
      cleanup() {},
    };
    return {
      promise: Promise.resolve(doc),
      destroy: async () => {
        destroyed.push(url);
      },
    };
  },
}));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/worker.mjs' }));

beforeEach(() => {
  destroyed.length = 0;
  // jsdom belum punya Element.scrollTo (dipakai untuk lompat ke halaman yang cocok).
  Element.prototype.scrollTo = () => {};
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {
      this.callback([{ contentRect: { width: 500 } }]);
    }
    disconnect() {}
  });
  vi.stubGlobal('IntersectionObserver', class {
    observe() {}
    disconnect() {}
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

test('pindah ke PDF lain tidak error (regresi: n?.destroy is not a function)', async () => {
  const { default: PdfPreview } = await import('./PdfPreview.jsx');
  const view = render(<PdfPreview src="/api/items/8/download?inline=1" terms={['ahjt']} />);
  await flush();
  expect(screen.getByText(/Hal 1 \/ 2/)).toBeTruthy();
  expect(screen.getByText('2 halaman cocok')).toBeTruthy();

  expect(() => view.rerender(<PdfPreview src="/api/items/9/download?inline=1" terms={[]} />)).not.toThrow();
  await flush();
  expect(destroyed).toEqual(['/api/items/8/download?inline=1']);

  expect(() => view.unmount()).not.toThrow();
  expect(destroyed).toEqual(['/api/items/8/download?inline=1', '/api/items/9/download?inline=1']);
});

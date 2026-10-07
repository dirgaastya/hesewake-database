import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, TextLayer } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ChevronDown, ChevronUp, ExternalLink, Maximize2, Minus, Plus } from 'lucide-react';
import { clampZoom, highlightSegments, pageMatches } from '../lib/pdf-search.js';
import { IconButton, MetaLabel } from './ui.jsx';

GlobalWorkerOptions.workerSrc = workerUrl;

const ASSETS = { cMapUrl: '/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdfjs/standard_fonts/', wasmUrl: '/pdfjs/wasm/' };
const PAGE_GAP = 12;
const PADDING = 12;
const MAX_SEARCH_PAGES = 400;

function highlightLayer(container, terms) {
  if (!terms.length) return;
  for (const span of container.querySelectorAll('span:not(.markedContent)')) {
    const segments = highlightSegments(span.textContent, terms);
    if (!segments.some((segment) => segment.match)) continue;
    span.replaceChildren(
      ...segments.map((segment) => {
        if (!segment.match) return document.createTextNode(segment.text);
        const mark = document.createElement('mark');
        mark.className = 'pdf-hit';
        mark.textContent = segment.text;
        return mark;
      }),
    );
  }
}

// Satu halaman: digambar hanya saat dekat area pandang, dan dibersihkan saat jauh supaya PDF tebal tetap ringan.
function PdfPage({ doc, number, size, scale, terms, root }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const textRef = useRef(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node || !root) return undefined;
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { root, rootMargin: '900px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [root]);

  useEffect(() => {
    if (!near) return undefined;
    let cancelled = false;
    let renderTask = null;
    let textLayer = null;
    (async () => {
      const page = await doc.getPage(number);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const ratio = window.devicePixelRatio || 1;
      const canvas = canvasRef.current;
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0] });
      await renderTask.promise;
      if (cancelled) return;
      const container = textRef.current;
      container.replaceChildren();
      container.style.setProperty('--total-scale-factor', String(scale));
      textLayer = new TextLayer({ textContentSource: page.streamTextContent(), container, viewport });
      await textLayer.render();
      if (!cancelled) highlightLayer(container, terms);
    })().catch((err) => {
      if (err?.name !== 'RenderingCancelledException') console.warn(`Halaman ${number} gagal digambar: ${err.message}`);
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
      if (canvasRef.current) canvasRef.current.width = 0;
      textRef.current?.replaceChildren();
    };
  }, [near, doc, number, scale, terms]);

  return (
    <div
      ref={wrapRef}
      data-page={number}
      className="relative mx-auto bg-white shadow-[0_0_0_1px_var(--line)]"
      style={{ width: size.width * scale, height: size.height * scale }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" aria-label={`Halaman ${number}`} />
      <div ref={textRef} className="textLayer" />
    </div>
  );
}

export default function PdfPreview({ src, terms = [] }) {
  const scrollRef = useRef(null);
  const [root, setRoot] = useState(null);
  const [doc, setDoc] = useState(null);
  const [sizes, setSizes] = useState([]);
  const [error, setError] = useState('');
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [current, setCurrent] = useState(1);
  const [hits, setHits] = useState([]);
  const [hitIndex, setHitIndex] = useState(0);
  const jumpedFor = useRef(null);
  const termKey = terms.join(' ');

  useEffect(() => {
    let cancelled = false;
    let loaded = null;
    const task = getDocument({ url: src, ...ASSETS });
    task.promise
      .then(async (pdf) => {
        loaded = pdf;
        const dims = [];
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n);
          const viewport = page.getViewport({ scale: 1 });
          dims.push({ width: viewport.width, height: viewport.height });
          if (cancelled) return;
        }
        setSizes(dims);
        setDoc(pdf);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.name === 'PasswordException' ? 'PDF ini dilindungi password. Buka di tab baru untuk memasukkan password.' : `PDF tidak bisa ditampilkan: ${err.message}`);
      });
    return () => {
      cancelled = true;
      task.destroy();
      loaded?.destroy();
    };
  }, [src]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return undefined;
    setRoot(node);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Cari halaman yang memuat kata dari kotak search, lalu loncat ke yang pertama.
  useEffect(() => {
    if (!doc || !terms.length) {
      setHits([]);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      const found = [];
      const last = Math.min(doc.numPages, MAX_SEARCH_PAGES);
      for (let n = 1; n <= last; n++) {
        const page = await doc.getPage(n);
        const content = await page.getTextContent();
        if (cancelled) return;
        if (pageMatches(content.items.map((item) => item.str).join(' '), terms)) found.push(n);
      }
      setHits(found);
      setHitIndex(0);
    })();
    return () => {
      cancelled = true;
    };
    // termKey mewakili isi terms.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, termKey]);

  const fitScale = sizes.length && width ? (width - PADDING * 2) / Math.max(...sizes.map((s) => s.width)) : 0;
  const scale = fitScale * zoom;

  const scrollToPage = useCallback((number) => {
    const node = scrollRef.current?.querySelector(`[data-page="${number}"]`);
    if (node) scrollRef.current.scrollTo({ top: node.offsetTop - PADDING, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (!hits.length || !scale || jumpedFor.current === termKey) return;
    jumpedFor.current = termKey;
    requestAnimationFrame(() => scrollToPage(hits[0]));
  }, [hits, scale, termKey, scrollToPage]);

  // Halaman aktif = halaman terakhir yang bagian atasnya sudah lewat sepertiga area tampil (tetap benar saat di-zoom).
  const onScroll = () => {
    const node = scrollRef.current;
    if (!node) return;
    const line = node.scrollTop + node.clientHeight / 3;
    let page = 1;
    for (const child of node.querySelectorAll('[data-page]')) {
      if (child.offsetTop <= line) page = Number(child.dataset.page);
      else break;
    }
    setCurrent(page);
  };

  const gotoHit = (delta) => {
    if (!hits.length) return;
    const next = (hitIndex + delta + hits.length) % hits.length;
    setHitIndex(next);
    scrollToPage(hits[next]);
  };

  const stableTerms = useMemo(() => terms, [termKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="grid min-w-0 overflow-hidden rounded-sm bg-surface-2">
      <div className="flex h-8 items-center gap-1 border-b border-line pl-3 pr-1">
        <MetaLabel
          className="flex-1"
          items={[doc ? `Hal ${current} / ${doc.numPages}` : 'Memuat PDF', terms.length ? (hits.length ? `${hits.length} halaman cocok` : doc ? 'Tidak ada yang cocok' : null) : null, `${Math.round(zoom * 100)}%`]}
        />
        {hits.length > 0 && (
          <>
            <IconButton icon={ChevronUp} size={14} label="Halaman cocok sebelumnya" onClick={() => gotoHit(-1)} />
            <IconButton icon={ChevronDown} size={14} label="Halaman cocok berikutnya" onClick={() => gotoHit(1)} />
          </>
        )}
        <IconButton icon={Minus} size={14} label="Perkecil" onClick={() => setZoom((z) => clampZoom(z - 0.25))} disabled={zoom <= 0.5} />
        <IconButton icon={Plus} size={14} label="Perbesar" onClick={() => setZoom((z) => clampZoom(z + 0.25))} disabled={zoom >= 3} />
        <IconButton icon={Maximize2} size={14} label="Pas lebar" onClick={() => setZoom(1)} disabled={zoom === 1} />
        <a href={src} target="_blank" rel="noreferrer" aria-label="Buka penuh di tab baru" title="Buka penuh di tab baru" className="inline-grid size-6 place-items-center rounded-xs text-fg-muted hover:bg-line hover:text-fg">
          <ExternalLink size={14} strokeWidth={1.5} />
        </a>
      </div>
      <div ref={scrollRef} onScroll={onScroll} className="relative h-[70vh] min-h-[420px] overflow-auto" style={{ padding: PADDING }}>
        {error ? (
          <p className="m-0 text-[13px] text-fg-muted">{error}</p>
        ) : !doc || !scale ? (
          <div className="mx-auto h-full w-full max-w-[600px] bg-surface" aria-busy="true" aria-label="Memuat PDF" />
        ) : (
          <div className="grid justify-items-center" style={{ gap: PAGE_GAP }}>
            {sizes.map((size, i) => (
              <PdfPage key={i + 1} doc={doc} number={i + 1} size={size} scale={scale} terms={stableTerms} root={root} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

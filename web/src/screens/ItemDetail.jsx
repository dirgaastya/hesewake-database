import { Suspense, lazy, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Archive, ArchiveRestore, Check, Copy, Download, ExternalLink, History, Pencil, Pin, PinOff, RotateCcw, Trash2, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { navigate, useDocumentTitle, useLocation } from '../lib/router.js';
import { readListState } from '../lib/workspace-url.js';
import { parseSearch } from '../lib/search-query.js';
import { searchTerms } from '../lib/pdf-search.js';
import { useItem, useRefresh } from '../lib/queries.js';
import { relativeTime, formatBytes, padId, daysLeft } from '../lib/format.js';
import { typeMeta, FIELD_LABELS, CODE_TYPES } from '../lib/types.js';
import { findPlaceholders, fillPlaceholders } from '../lib/placeholders.js';
import { buildCurl, copyText } from '../lib/clipboard.js';
import { useShortcuts } from '../lib/shortcuts.js';
import { spring } from '../lib/motion.js';
import { useVault } from '../vault/VaultProvider.jsx';
import { useRequestUnlock } from '../vault/UnlockDialog.jsx';
import { useToast } from '../components/Toast.jsx';
import { Dialog } from '../components/Dialog.jsx';
import { CodeEditor, languageFor, languageLabel } from '../components/Code.jsx';
import { Markdown } from '../components/Markdown.jsx';
import { SecretField, copySecret } from '../components/SecretField.jsx';
import { Button, EmptyState, Field, IconButton, MetaLabel, TextInput, TypeStamp, SkeletonRows } from '../components/ui.jsx';
import { TicketInfo } from '../components/TicketInfo.jsx';
import { RelatedItems } from '../components/RelatedItems.jsx';
import { ItemCollections } from '../components/CollectionDialogs.jsx';

// pdf.js cukup besar, jadi baru dimuat saat membuka item PDF.
const PdfPreview = lazy(() => import('../components/PdfPreview.jsx'));

const COPY_LABEL = {
  query: 'Salin query',
  command: 'Salin command',
  config: 'Salin config',
  schema: 'Salin',
  api_request: 'Salin sebagai curl',
  link: 'Salin URL',
  secret: 'Salin secret',
  error_solution: 'Salin solusi',
};
const INLINE_MIME = /^(image\/(png|jpe?g|gif|webp)|application\/pdf|text\/plain)$/;

function copySource(item) {
  if (item.type === 'link') return item.metadata.url;
  if (item.type === 'api_request') return buildCurl(item.metadata);
  return item.content ?? '';
}

function CopyLabel({ copied, children }) {
  return (
    <>
      <span className="relative inline-grid size-4 place-items-center">
        <AnimatePresence initial={false} mode="popLayout">
          {copied ? (
            <motion.span key="check" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1, transition: spring.bouncy }} exit={{ opacity: 0, transition: { duration: 0.12 } }}>
              <Check size={16} strokeWidth={2} />
            </motion.span>
          ) : (
            <motion.span key="copy" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ scale: 0.6, opacity: 0, transition: { duration: 0.1 } }}>
              <Copy size={16} strokeWidth={1.5} />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      {copied ? 'Disalin' : children}
    </>
  );
}

function MetadataList({ item, skip = [] }) {
  const entries = Object.entries(item.metadata).filter(([key]) => !skip.includes(key));
  if (!entries.length) return null;
  return (
    <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
      {entries.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="font-mono text-[11px] font-medium uppercase leading-5 tracking-[0.06em] text-fg-subtle">{FIELD_LABELS[key] ?? key}</dt>
          <dd className="m-0 min-w-0 select-text break-words font-mono text-[13px] leading-5">
            {/^https?:\/\//.test(value) ? (
              <a href={value} target="_blank" rel="noreferrer noopener" className="text-accent-text underline decoration-1 underline-offset-2">
                {value}
              </a>
            ) : (
              value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Section({ label, children }) {
  return (
    <section className="grid gap-2">
      {label && <MetaLabel items={[label]} />}
      {children}
    </section>
  );
}

function CodeSection({ item, onCopy, copied }) {
  const language = languageFor(item);
  const lines = (item.content ?? '').split('\n').length;
  return (
    <div className="min-w-0 overflow-hidden rounded-sm bg-surface-2">
      <div className="flex h-8 items-center gap-2 border-b border-line pl-3 pr-1">
        <MetaLabel className="flex-1" items={[languageLabel(language), item.metadata.database, `${lines} baris`]} />
        <Button size="sm" variant="ghost" onClick={onCopy}>
          <CopyLabel copied={copied}>Salin</CopyLabel>
        </Button>
      </div>
      <CodeEditor value={item.content ?? ''} language={language} readOnly minHeight="0" maxHeight="480px" className="rounded-none" />
    </div>
  );
}

function FileSection({ item, terms }) {
  const href = `/api/items/${item.id}/download`;
  const inline = INLINE_MIME.test(item.file.mime);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <MetaLabel className="mr-auto" items={[item.file.mime, formatBytes(item.file.size)]} />
        {inline && (
          <a href={`${href}?inline=1`} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-2 rounded-sm bg-surface-2 px-2 text-xs font-medium text-fg no-underline hover:bg-line">
            <ExternalLink size={14} strokeWidth={1.5} /> Buka di tab baru
          </a>
        )}
        <a href={href} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-2 rounded-sm bg-surface-2 px-2 text-xs font-medium text-fg no-underline hover:bg-line">
          <Download size={14} strokeWidth={1.5} /> Unduh
        </a>
      </div>
      {item.file.mime === 'application/pdf' && (
        <Suspense fallback={<div className="h-[70vh] min-h-[420px] rounded-sm bg-surface-2" aria-busy="true" />}>
          <PdfPreview src={`${href}?inline=1`} terms={terms} />
        </Suspense>
      )}
      {/^image\//.test(item.file.mime) && inline && (
        <img src={`${href}?inline=1`} alt={item.title} className="max-h-[420px] max-w-full rounded-sm border border-line object-contain" />
      )}
    </div>
  );
}

function LinkSection({ item }) {
  const { url, description, image } = item.metadata;
  let host = url;
  try {
    host = new URL(url).hostname;
  } catch {
    host = url;
  }
  return (
    <a href={url} target="_blank" rel="noreferrer noopener" className="flex min-w-0 items-center gap-3 rounded-sm border border-line bg-surface p-3 text-fg no-underline hover:border-line-strong">
      {image ? (
        <img src={image} alt="" className="size-16 shrink-0 rounded-xs bg-surface-2 object-cover" referrerPolicy="no-referrer" />
      ) : (
        <span className="grid size-16 shrink-0 place-items-center rounded-xs bg-surface-2 text-fg-subtle">
          <ExternalLink size={20} strokeWidth={1.5} />
        </span>
      )}
      <span className="grid min-w-0 gap-0.5">
        <span className="truncate text-sm font-semibold">{host}</span>
        {description && <span className="line-clamp-2 text-[13px] leading-5 text-fg-muted">{description}</span>}
        <span className="truncate font-mono text-xs text-accent-text">{url}</span>
      </span>
    </a>
  );
}

function Body({ item, onCopy, copied, terms }) {
  if (item.type === 'secret') {
    return (
      <>
        <SecretField payload={item.content} />
        <MetadataList item={item} />
      </>
    );
  }
  if (CODE_TYPES.has(item.type)) {
    return (
      <>
        <CodeSection item={item} onCopy={onCopy} copied={copied} />
        <MetadataList item={item} skip={['language', 'database', 'shell', 'format']} />
      </>
    );
  }
  if (item.type === 'link') {
    return (
      <>
        <LinkSection item={item} />
        {item.content && (
          <Section label="Catatan">
            <Markdown>{item.content}</Markdown>
          </Section>
        )}
      </>
    );
  }
  if (item.type === 'file') {
    return (
      <>
        <FileSection item={item} terms={terms} />
        {item.content && (
          <Section label="Catatan">
            <Markdown>{item.content}</Markdown>
          </Section>
        )}
      </>
    );
  }
  if (item.type === 'error_solution') {
    return (
      <>
        <Section label="Pesan error">
          <pre className="m-0 max-h-60 overflow-auto whitespace-pre-wrap rounded-sm bg-danger-soft px-3 py-2 font-mono text-[13px] leading-5 text-fg">{item.metadata.error_message}</pre>
        </Section>
        {item.metadata.cause && (
          <Section label="Penyebab">
            <p className="m-0 text-sm leading-[22px]">{item.metadata.cause}</p>
          </Section>
        )}
        <Section label="Solusi">{item.content ? <Markdown>{item.content}</Markdown> : <p className="m-0 text-[13px] text-fg-subtle">Belum ada solusi. Tekan E untuk menambahkan.</p>}</Section>
      </>
    );
  }
  if (item.type === 'api_request') {
    return (
      <>
        <p className="m-0 select-text break-all font-mono text-[13px]">
          <b className="font-semibold text-accent-text">{item.metadata.method}</b> {item.metadata.url}
        </p>
        {item.metadata.headers && (
          <Section label="Headers">
            <CodeEditor value={item.metadata.headers} language="properties" readOnly minHeight="0" />
          </Section>
        )}
        {item.metadata.body && (
          <Section label="Body">
            <CodeEditor value={item.metadata.body} language="json" readOnly minHeight="0" />
          </Section>
        )}
        {item.content && (
          <Section label="Catatan">
            <Markdown>{item.content}</Markdown>
          </Section>
        )}
      </>
    );
  }
  return (
    <>
      <MetadataList item={item} />
      {item.content ? <Markdown>{item.content}</Markdown> : <p className="m-0 text-[13px] text-fg-subtle">Belum ada isi. Tekan E untuk menulis.</p>}
    </>
  );
}

export function ItemDetail({ itemId, suffix, onClose }) {
  const query = useItem(itemId);
  const refresh = useRefresh();
  const toast = useToast();
  const vault = useVault();
  const requestUnlock = useRequestUnlock();
  const [copied, setCopied] = useState(false);
  const [fill, setFill] = useState(null);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const cancelRef = useRef(null);
  const item = query.data;
  useDocumentTitle(item?.title);
  // Kata yang sedang dicari di daftar ikut disorot di pratinjau PDF.
  const { search } = useLocation();
  const terms = useMemo(() => searchTerms(parseSearch(readListState(search).q).text), [search]);

  const placeholders = useMemo(() => (item && CODE_TYPES.has(item.type) ? findPlaceholders(item.content) : []), [item]);

  const flashCopied = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const doCopy = async (text, label) => {
    await copyText(text);
    flashCopied();
    toast(`${label} disalin.`);
  };

  const copy = async () => {
    if (!item) return;
    if (item.type === 'secret') return copySecret({ vault, requestUnlock, toast, payload: item.content, label: 'Secret' }).catch((err) => toast(err.message, { success: false }));
    if (placeholders.length) return setFill(Object.fromEntries(placeholders.map((name) => [name, ''])));
    const label = { query: 'Query', command: 'Command', link: 'URL', api_request: 'Perintah curl' }[item.type] ?? 'Isi';
    return doCopy(copySource(item), label);
  };

  const mutate = async (fn, message, undo) => {
    try {
      await fn();
      refresh(itemId);
      if (message) toast(message, undo ? { action: { label: 'Urungkan', onClick: async () => { await undo(); refresh(itemId); } } } : undefined);
    } catch (err) {
      toast(err.message, { success: false });
    }
  };

  const patch = (body, message) => mutate(() => api(`/items/${itemId}`, { method: 'PATCH', body }), message);
  const trash = () =>
    mutate(
      () => api(`/items/${itemId}`, { method: 'DELETE' }),
      'Dipindah ke trash.',
      () => api(`/items/${itemId}/restore`, { method: 'POST' }),
    ).then(onClose);
  const purge = async () => {
    setConfirmPurge(false);
    await mutate(() => api(`/items/${itemId}?permanent=1`, { method: 'DELETE' }), 'Item dihapus permanen.');
    onClose();
  };

  useShortcuts({ c: copy }, Boolean(item) && !fill && !confirmPurge);

  if (query.isPending) return <SkeletonRows count={3} />;
  if (query.isError) {
    return (
      <EmptyState meta={['Detail']} title={query.error.status === 404 ? 'Item tidak ditemukan' : 'Gagal memuat item'} actions={<Button onClick={onClose}>Tutup</Button>}>
        {query.error.status === 404 ? 'Mungkin sudah dihapus permanen.' : query.error.message}
      </EmptyState>
    );
  }

  const meta = typeMeta(item.type);
  const trashed = Boolean(item.deletedAt);
  const copyLabel = COPY_LABEL[item.type];

  return (
    <article className="grid h-full content-start gap-6 overflow-y-auto px-6 py-4 max-[560px]:px-4">
      <header className="grid gap-2">
        <div className="flex items-start gap-2">
          <MetaLabel
            className="flex-1"
            items={[meta.label, padId(item.id), item.ticketId && `Tiket ${item.ticketId}`, `Diubah ${relativeTime(item.updatedAt)}`, item.archived && 'Arsip', trashed && { text: `Trash · ${daysLeft(item.deletedAt)} hari lagi`, tone: 'warning' }]}
          />
          <IconButton icon={X} label="Tutup (Esc)" onClick={onClose} />
        </div>
        <h1 className="m-0 select-text text-xl font-semibold leading-7 tracking-[-0.01em] [text-wrap:balance]">{item.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <TypeStamp type={item.type} />
          {item.tags.length > 0 && <MetaLabel as="span" items={item.tags.map((tag) => `#${tag}`)} />}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {trashed ? (
          <>
            <Button variant="primary" icon={RotateCcw} onClick={() => mutate(() => api(`/items/${itemId}/restore`, { method: 'POST' }), 'Item dikembalikan.')}>
              Kembalikan
            </Button>
            <Button variant="danger" icon={Trash2} onClick={() => setConfirmPurge(true)}>
              Hapus permanen
            </Button>
          </>
        ) : (
          <>
            {copyLabel && (
              <Button variant="primary" onClick={copy} shortcut="C">
                <CopyLabel copied={copied}>{copyLabel}</CopyLabel>
              </Button>
            )}
            <Button icon={Pencil} shortcut="E" onClick={() => navigate(`/items/${itemId}/edit${suffix}`)}>
              Edit
            </Button>
            <IconButton icon={item.pinned ? PinOff : Pin} label={item.pinned ? 'Lepas sematan' : 'Sematkan'} onClick={() => patch({ pinned: !item.pinned }, item.pinned ? 'Sematan dilepas.' : 'Disematkan.')} />
            <IconButton icon={item.archived ? ArchiveRestore : Archive} label={item.archived ? 'Keluarkan dari arsip' : 'Arsipkan'} onClick={() => patch({ archived: !item.archived }, item.archived ? 'Dikeluarkan dari arsip.' : 'Diarsipkan.')} />
            <IconButton icon={History} label="Riwayat versi (H)" onClick={() => navigate(`/items/${itemId}/history${suffix}`)} />
            <IconButton icon={Trash2} label="Pindahkan ke trash" onClick={trash} className="hover:text-danger" />
          </>
        )}
      </div>

      <Body item={item} onCopy={copy} copied={copied} terms={terms} />
      {item.ticketId && <TicketInfo ticketId={item.ticketId} />}
      <RelatedItems item={item} suffix={suffix} />
      <ItemCollections item={item} />

      <Dialog
        open={Boolean(fill)}
        onClose={() => setFill(null)}
        title="Isi variabel sebelum menyalin"
        description="Bagian yang dikosongkan tetap ditulis sebagai {{nama}}."
        footer={
          <>
            <Button variant="ghost" onClick={() => setFill(null)}>
              Batal
            </Button>
            <Button type="submit" form="fill-form" variant="primary" shortcut="↵">
              Salin
            </Button>
          </>
        }
      >
        <form
          id="fill-form"
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const text = fillPlaceholders(item.content, fill);
            setFill(null);
            doCopy(text, meta.label);
          }}
        >
          {fill &&
            Object.keys(fill).map((name, index) => (
              <Field key={name} label={`{{${name}}}`} htmlFor={`fill-${name}`}>
                <TextInput id={`fill-${name}`} mono autoFocus={index === 0} value={fill[name]} onChange={(e) => setFill({ ...fill, [name]: e.target.value })} />
              </Field>
            ))}
        </form>
      </Dialog>

      <Dialog
        open={confirmPurge}
        role="alertdialog"
        onClose={() => setConfirmPurge(false)}
        initialFocusRef={cancelRef}
        title="Hapus permanen?"
        description={`"${item.title}"${item.file ? ' beserta filenya' : ''} dihapus dari laptop server dan tidak bisa dikembalikan dari trash. Backup harian masih menyimpannya sampai 7 hari.`}
        footer={
          <>
            <Button ref={cancelRef} variant="ghost" onClick={() => setConfirmPurge(false)}>
              Batal
            </Button>
            <Button variant="danger-solid" onClick={purge}>
              Hapus permanen
            </Button>
          </>
        }
      />
    </article>
  );
}

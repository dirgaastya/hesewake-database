import { useEffect, useRef, useState } from 'react';
import { format as formatSql } from 'sql-formatter';
import { AlertTriangle, Dices, Eye, EyeOff, Wand2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useItem, useRefresh, useTypes } from '../lib/queries.js';
import { TYPE_META, TYPE_ORDER, FIELD_LABELS, MULTILINE_FIELDS, MONO_FIELDS, CONTENT_LABEL, CODE_TYPES } from '../lib/types.js';
import { takePendingDraft } from '../lib/draft.js';
import { generatePassword } from '../lib/password.js';
import { useShortcuts } from '../lib/shortcuts.js';
import { useDocumentTitle } from '../lib/router.js';
import { useVault } from '../vault/VaultProvider.jsx';
import { useRequestUnlock } from '../vault/UnlockDialog.jsx';
import { useToast } from '../components/Toast.jsx';
import { Dialog } from '../components/Dialog.jsx';
import { CodeEditor, languageFor } from '../components/Code.jsx';
import { TagInput } from '../components/TagInput.jsx';
import { Banner, Button, Field, IconButton, MetaLabel, Select, SkeletonRows, TextArea, TextInput, TypeStamp, cx } from '../components/ui.jsx';

const EMPTY = { type: 'note', title: '', metadata: {}, content: '', tags: [], ticketId: '' };

function fromItem(item) {
  return {
    type: item.type,
    title: item.title,
    metadata: { ...item.metadata },
    content: item.encrypted ? '' : item.content ?? '',
    tags: item.tags,
    ticketId: item.ticketId ? String(item.ticketId) : '',
  };
}

// Pesan validasi API ("metadata.language wajib diisi") dipetakan ke field-nya.
function fieldOfError(message) {
  const meta = message.match(/metadata\.(\w+)/);
  if (meta) return `metadata.${meta[1]}`;
  if (/^title/.test(message)) return 'title';
  if (/ticketId/.test(message)) return 'ticketId';
  return null;
}

function TypePicker({ value, onChange }) {
  return (
    <fieldset className="m-0 grid grid-cols-[repeat(auto-fill,minmax(156px,1fr))] gap-0.5 border-0 p-0" aria-label="Tipe item">
      {TYPE_ORDER.map((type) => (
        <button
          key={type}
          type="button"
          aria-pressed={value === type}
          onClick={() => onChange(type)}
          className={cx(
            'flex h-8 items-center gap-2 rounded-sm px-2 text-left text-[13px]',
            value === type ? 'bg-accent-soft font-semibold text-fg' : 'font-medium text-fg-muted hover:bg-surface-2 hover:text-fg',
          )}
        >
          <TypeStamp type={type} className="min-w-[68px]" />
          {TYPE_META[type].label}
        </button>
      ))}
    </fieldset>
  );
}

export function ItemForm({ itemId, initialType, onDone }) {
  const editing = itemId != null;
  const existing = useItem(itemId);
  const types = useTypes();
  const refresh = useRefresh();
  const toast = useToast();
  const vault = useVault();
  const requestUnlock = useRequestUnlock();
  const [form, setForm] = useState(() => {
    if (editing) return null;
    const draft = takePendingDraft();
    // Draft dari Quick Capture/command palette harus menang atas filter sidebar.
    return { ...EMPTY, type: TYPE_META[initialType] ? initialType : EMPTY.type, ...draft };
  });
  const [file, setFile] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [imageSource, setImageSource] = useState('upload');
  const [errors, setErrors] = useState({});
  const [general, setGeneral] = useState('');
  const [busy, setBusy] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dirty = useRef(false);
  const previewedUrl = useRef('');
  useDocumentTitle(editing ? 'Edit item' : 'Item baru');

  useEffect(() => {
    if (editing && existing.data && !form) setForm(fromItem(existing.data));
  }, [editing, existing.data, form]);

  const update = (patch) => {
    dirty.current = true;
    setForm((current) => ({ ...current, ...patch }));
  };
  const setMeta = (key, value) => update({ metadata: { ...form.metadata, [key]: value } });

  // Link: isi judul, deskripsi, dan gambar dari halaman tujuan.
  const previewLink = async (url) => {
    if (!/^https?:\/\//.test(url) || previewedUrl.current === url) return;
    previewedUrl.current = url;
    try {
      const preview = await api(`/link-preview?url=${encodeURIComponent(url)}`);
      setForm((current) => ({
        ...current,
        title: current.title || preview.title,
        metadata: {
          ...current.metadata,
          url: current.metadata.url,
          description: current.metadata.description || preview.description,
          image: current.metadata.image || preview.image,
        },
      }));
    } catch {
      // Preview cuma pemanis; link tetap bisa disimpan.
    }
  };

  useEffect(() => {
    if (form?.type === 'link' && form.metadata.url && !editing) previewLink(form.metadata.url);
    // Hanya saat form pertama kali terisi dari QuickCapture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form?.type]);

  const cancel = () => (dirty.current ? setConfirmDiscard(true) : onDone(null));

  const submit = async (event) => {
    event?.preventDefault();
    if (busy || !form) return;
    setBusy(true);
    setErrors({});
    setGeneral('');
    try {
      const ticketId = form.ticketId ? Number(form.ticketId) : null;
      let saved;
      if (!editing && form.type === 'file') {
        if (!file) throw Object.assign(new Error('Pilih file yang mau diunggah.'), { field: 'file' });
        const body = new FormData();
        body.append('file', file);
        if (form.title) body.append('title', form.title);
        if (form.content) body.append('content', form.content);
        if (form.tags.length) body.append('tags', form.tags.join(','));
        if (ticketId) body.append('ticketId', String(ticketId));
        saved = await api('/files', { method: 'POST', form: body });
      } else {
        const body = { title: form.title, metadata: form.metadata, tags: form.tags, ticketId };
        if (form.type === 'secret') {
          if (!editing || form.content) {
            if (!form.content) throw Object.assign(new Error('Isi nilai secret.'), { field: 'content' });
            if (!vault.unlocked && !(await requestUnlock())) throw new Error('Vault harus dibuka untuk menyimpan secret.');
            body.content = await vault.encrypt(form.content);
          }
        } else {
          body.content = form.content;
        }
        saved = editing
          ? await api(`/items/${itemId}`, { method: 'PATCH', body })
          : await api('/items', { method: 'POST', body: { ...body, type: form.type } });
        if (form.type === 'link' && imageFile) {
          const image = new FormData();
          image.append('file', imageFile);
          saved = await api(`/items/${saved.id}/image`, { method: 'POST', form: image });
        }
      }
      refresh(saved.id);
      dirty.current = false;
      toast(editing ? 'Perubahan disimpan.' : `${TYPE_META[saved.type].label} disimpan.`);
      onDone(saved);
    } catch (err) {
      const field = err.field ?? fieldOfError(err.message);
      if (field) setErrors({ [field]: err.message });
      else setGeneral(err.message);
      setBusy(false);
    }
  };

  useShortcuts({ 'mod+Enter': submit, Escape: cancel }, Boolean(form) && !confirmDiscard);

  if (editing && (existing.isPending || !form)) return <SkeletonRows count={3} />;
  if (editing && existing.isError) return <Banner tone="danger" icon={AlertTriangle}>{existing.error.message}</Banner>;

  const def = types.data?.[form.type] ?? { fields: [] };
  const meta = TYPE_META[form.type];
  const isCode = CODE_TYPES.has(form.type);
  const language = languageFor(form);
  const contentLabel = CONTENT_LABEL[form.type] ?? 'Isi';

  return (
    <form className="grid h-full content-start gap-4 overflow-y-auto px-6 py-4 max-[560px]:px-4" onSubmit={submit}>
      <MetaLabel items={[editing ? 'Edit item' : 'Item baru', 'Ctrl ↵ simpan', 'Esc batal']} />
      {general && (
        <Banner tone="danger" icon={AlertTriangle}>
          {general}
        </Banner>
      )}

      {editing ? (
        <div className="flex items-center gap-2">
          <TypeStamp type={form.type} />
          <span className="text-[13px] text-fg-muted">{meta.label}</span>
        </div>
      ) : (
        <TypePicker value={form.type} onChange={(type) => update({ type, metadata: type === 'query' ? { language: 'sql' } : {} })} />
      )}

      <div className="grid gap-3 border-t border-line pt-4">
        <Field label="Judul" required={form.type !== 'file'} htmlFor="item-title" error={errors.title}>
          <TextInput id="item-title" value={form.title} onChange={(e) => update({ title: e.target.value })} invalid={Boolean(errors.title)} autoFocus={!editing} placeholder={form.type === 'file' ? 'Kosongkan untuk memakai nama file' : ''} />
        </Field>

        {def.fields.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-x-4 gap-y-3">
            {def.fields.filter((field) => field.key !== 'imageFile').map((field) => {
              const id = `meta-${field.key}`;
              const error = errors[`metadata.${field.key}`];
              const value = form.metadata[field.key] ?? '';
              const wide = MULTILINE_FIELDS.has(field.key);
              return (
                <Field key={field.key} label={FIELD_LABELS[field.key] ?? field.key} required={field.required} htmlFor={id} error={error} className={wide ? 'col-span-full' : ''}>
                  {field.key === 'image' ? (
                    <div className="grid gap-2">
                      <div className="flex gap-1"><Button size="sm" variant={imageSource === 'upload' ? 'secondary' : 'ghost'} onClick={() => setImageSource('upload')}>Upload</Button><Button size="sm" variant={imageSource === 'url' ? 'secondary' : 'ghost'} onClick={() => setImageSource('url')}>URL / CDN</Button></div>
                      {imageSource === 'upload' ? <input id={id} type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => setImageFile(e.target.files?.[0] ?? null)} className="text-[13px] file:mr-3 file:h-8 file:rounded-sm file:border-0 file:bg-surface-2 file:px-3 file:text-[13px] file:font-medium file:text-fg" /> : <TextInput id={id} mono value={value} invalid={Boolean(error)} onChange={(e) => update({ metadata: { ...form.metadata, image: e.target.value, imageFile: '', imageMime: '' } })} />}
                    </div>
                  ) : field.options ? (
                    <Select id={id} value={value} onChange={(e) => setMeta(field.key, e.target.value)} options={[...(field.required ? [] : [{ value: '', label: '—' }]), ...field.options]} />
                  ) : wide ? (
                    <TextArea id={id} rows={field.key === 'error_message' ? 4 : 3} value={value} invalid={Boolean(error)} onChange={(e) => setMeta(field.key, e.target.value)} />
                  ) : (
                    <TextInput id={id} type={field.key === 'date' ? 'date' : 'text'} mono={MONO_FIELDS.has(field.key)} value={value} invalid={Boolean(error)} onChange={(e) => setMeta(field.key, e.target.value)} onBlur={field.key === 'url' && form.type === 'link' ? (e) => previewLink(e.target.value.trim()) : undefined} list={field.key === 'language' ? 'language-options' : undefined} />
                  )}
                </Field>
              );
            })}
            <datalist id="language-options">
              {['sql', 'postgresql', 'mysql', 'sqlite', 'mssql'].map((lang) => (
                <option key={lang} value={lang} />
              ))}
            </datalist>
          </div>
        )}

        {form.type === 'link' && form.metadata.image && (
          <img src={form.metadata.image} alt="" className="h-20 w-36 rounded-xs border border-line object-cover" referrerPolicy="no-referrer" />
        )}

        <Field label="Tiket Odoo" required={form.type === 'worklog'} htmlFor="item-ticket" error={errors.ticketId} className="max-w-56">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-xs text-accent-text">#</span>
            <TextInput id="item-ticket" mono inputMode="numeric" className="pl-6" value={form.ticketId} invalid={Boolean(errors.ticketId)} onChange={(e) => update({ ticketId: e.target.value.replace(/\D/g, '') })} />
          </div>
        </Field>

        {form.type === 'file' && !editing && (
          <Field label="File" required htmlFor="item-file" error={errors.file} hint="PDF, Word, dan Excel ikut bisa dicari isinya.">
            <input id="item-file" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[13px] file:mr-3 file:h-8 file:rounded-sm file:border-0 file:bg-surface-2 file:px-3 file:text-[13px] file:font-medium file:text-fg" />
          </Field>
        )}

        {form.type === 'secret' ? (
          <Field label={editing ? 'Nilai baru' : 'Nilai secret'} required={!editing} htmlFor="item-secret" error={errors.content} hint={editing ? 'Kosongkan kalau tidak diganti. Nilai dienkripsi di browser sebelum dikirim.' : 'Dienkripsi di browser sebelum dikirim. Server hanya menyimpan versi terenkripsi.'}>
            <div className="flex items-center gap-1">
              <TextInput id="item-secret" type={showSecret ? 'text' : 'password'} mono autoComplete="new-password" value={form.content} invalid={Boolean(errors.content)} onChange={(e) => update({ content: e.target.value })} />
              <IconButton icon={showSecret ? EyeOff : Eye} label={showSecret ? 'Sembunyikan' : 'Lihat'} onClick={() => setShowSecret((v) => !v)} />
              <IconButton icon={Dices} label="Buat password acak" onClick={() => { update({ content: generatePassword() }); setShowSecret(true); }} />
            </div>
          </Field>
        ) : (
          <Field label={contentLabel} htmlFor="item-content" error={errors.content} hint={isCode ? 'Tulis {{nama}} untuk bagian yang diisi saat menyalin.' : 'Markdown didukung, termasuk diagram ```mermaid.'}>
            {isCode ? (
              <div className="grid gap-1">
                {language === 'sql' && (
                  <div className="flex justify-end">
                    <Button size="sm" variant="ghost" icon={Wand2} onClick={() => {
                      try {
                        update({ content: formatSql(form.content, { language: 'postgresql', keywordCase: 'upper' }) });
                      } catch (err) {
                        setErrors({ content: `Tidak bisa diformat: ${err.message.split('\n')[0]}` });
                      }
                    }}>
                      Format SQL
                    </Button>
                  </div>
                )}
                <CodeEditor value={form.content} onChange={(content) => update({ content })} language={language} minHeight="160px" maxHeight="520px" ariaLabel={contentLabel} />
              </div>
            ) : (
              <TextArea id="item-content" mono={false} rows={8} value={form.content} onChange={(e) => update({ content: e.target.value })} />
            )}
          </Field>
        )}

        <Field label="Tag" htmlFor="item-tags">
          <TagInput id="item-tags" value={form.tags} onChange={(tags) => update({ tags })} />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <span className="mr-auto text-xs text-fg-subtle">{editing ? 'Versi sebelumnya tersimpan di riwayat.' : ''}</span>
        <Button variant="ghost" onClick={cancel}>
          Batal
        </Button>
        <Button type="submit" variant="primary" shortcut="Ctrl ↵" disabled={busy}>
          {busy ? 'Menyimpan…' : editing ? 'Simpan perubahan' : `Simpan ${meta.label.toLowerCase()}`}
        </Button>
      </div>

      <Dialog
        open={confirmDiscard}
        role="alertdialog"
        onClose={() => setConfirmDiscard(false)}
        title="Buang perubahan?"
        description="Isi form yang belum disimpan akan hilang."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDiscard(false)}>
              Lanjut edit
            </Button>
            <Button variant="danger-solid" onClick={() => onDone(null)}>
              Buang
            </Button>
          </>
        }
      />
    </form>
  );
}

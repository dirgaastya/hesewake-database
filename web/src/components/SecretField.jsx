import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Copy, Eye, EyeOff, Lock } from 'lucide-react';
import { useVault } from '../vault/VaultProvider.jsx';
import { useRequestUnlock } from '../vault/UnlockDialog.jsx';
import { useToast } from './Toast.jsx';
import { copyText, clearClipboardIfUnchanged } from '../lib/clipboard.js';
import { Button, IconButton, MetaLabel } from './ui.jsx';

const REVEAL_SECONDS = 30;
const CLEAR_AFTER_MS = 30_000;

export async function copySecret({ vault, requestUnlock, toast, payload, label = 'Secret' }) {
  if (!vault.unlocked && !(await requestUnlock())) return;
  const value = await vault.decrypt(payload);
  await copyText(value);
  toast(`${label} disalin. Clipboard dikosongkan dalam 30 detik.`);
  setTimeout(async () => {
    const cleared = await clearClipboardIfUnchanged(value);
    if (!cleared) toast('Clipboard belum dikosongkan. Hapus sendiri setelah menempel.', { success: false, duration: 6000 });
  }, CLEAR_AFTER_MS);
}

export function SecretField({ payload, label = 'Nilai secret' }) {
  const vault = useVault();
  const requestUnlock = useRequestUnlock();
  const toast = useToast();
  const [plain, setPlain] = useState(null);
  const [left, setLeft] = useState(0);
  const timer = useRef(null);

  useEffect(() => {
    if (!vault.unlocked) setPlain(null);
  }, [vault.unlocked]);

  useEffect(() => {
    if (plain === null) return undefined;
    setLeft(REVEAL_SECONDS);
    timer.current = setInterval(() => {
      setLeft((value) => {
        if (value <= 1) {
          setPlain(null);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => clearInterval(timer.current);
  }, [plain]);

  const reveal = async () => {
    if (plain !== null) return setPlain(null);
    if (!vault.unlocked && !(await requestUnlock())) return;
    try {
      setPlain(await vault.decrypt(payload));
    } catch (err) {
      toast(err.message, { success: false });
    }
  };

  const copy = () => copySecret({ vault, requestUnlock, toast, payload }).catch((err) => toast(err.message, { success: false }));

  return (
    <div className="grid gap-1">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      <div className="flex h-8 items-center gap-0.5 rounded-sm border border-line bg-surface pl-3 pr-1">
        {vault.unlocked ? (
          <>
            <span className="relative h-5 min-w-0 flex-1 overflow-hidden font-mono text-[13px] font-medium leading-5">
              <AnimatePresence initial={false} mode="popLayout">
                {plain === null ? (
                  <motion.span key="dots" className="absolute inset-0 tracking-[0.18em] text-fg-muted" initial={{ opacity: 0, filter: 'blur(4px)' }} animate={{ opacity: 1, filter: 'blur(0px)' }} exit={{ opacity: 0, filter: 'blur(4px)', transition: { duration: 0.12 } }}>
                    ••••••••••••
                  </motion.span>
                ) : (
                  <motion.span key="plain" className="absolute inset-0 truncate text-fg" initial={{ opacity: 0, filter: 'blur(4px)' }} animate={{ opacity: 1, filter: 'blur(0px)', transition: { duration: 0.2 } }} exit={{ opacity: 0, filter: 'blur(4px)', transition: { duration: 0.12 } }}>
                    {plain}
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
            <IconButton icon={plain === null ? Eye : EyeOff} label={plain === null ? 'Lihat' : 'Sembunyikan'} onClick={reveal} />
            <IconButton icon={Copy} label="Salin" onClick={copy} />
          </>
        ) : (
          <>
            <span className="flex-1 text-[13px] text-fg-subtle">Vault terkunci</span>
            <Button size="sm" icon={Lock} onClick={requestUnlock}>
              Unlock vault
            </Button>
          </>
        )}
      </div>
      {plain !== null && <MetaLabel items={[{ text: `Tersembunyi lagi dalam 0:${String(left).padStart(2, '0')}`, tone: 'warning' }]} />}
    </div>
  );
}

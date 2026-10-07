import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { spring, exit } from '../lib/motion.js';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

// Modal sesuai design system: lebar maks 400px, scrim 40%, Esc/klik scrim = batal, fokus terkunci di dalam.
export function Dialog({ open, onClose, title, description, children, footer, role = 'dialog', width = 400, initialFocusRef }) {
  const panelRef = useRef(null);
  const previous = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    previous.current = document.activeElement;
    const timer = setTimeout(() => {
      const target = initialFocusRef?.current ?? panelRef.current?.querySelector(FOCUSABLE);
      target?.focus();
    }, 0);
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose?.();
      }
      if (event.key === 'Tab' && panelRef.current) {
        const nodes = [...panelRef.current.querySelectorAll(FOCUSABLE)];
        if (!nodes.length) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKey, true);
      previous.current?.focus?.();
    };
  }, [open, onClose, initialFocusRef]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 grid justify-items-center overflow-y-auto px-4 pt-[16vh]">
          <motion.div
            className="fixed inset-0 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.2 } }}
            exit={{ opacity: 0, transition: exit }}
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            role={role}
            aria-modal="true"
            aria-label={title}
            className="relative h-fit w-full overflow-hidden rounded-md bg-surface text-fg shadow-float"
            style={{ maxWidth: width }}
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: spring.smooth }}
            exit={{ opacity: 0, scale: 0.98, transition: exit }}
          >
            {(title || description) && (
              <div className="grid gap-1 px-4 pt-4">
                {title && <h2 className="m-0 text-sm font-semibold">{title}</h2>}
                {description && <p className="m-0 text-[13px] leading-5 text-fg-muted">{description}</p>}
              </div>
            )}
            {children ? <div className="grid gap-3 p-4">{children}</div> : <div className="h-4" />}
            {footer && <div className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

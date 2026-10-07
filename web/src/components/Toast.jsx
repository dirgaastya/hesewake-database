import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check } from 'lucide-react';
import { spring, exit } from '../lib/motion.js';

const ToastContext = createContext(null);

// Satu toast saja; toast baru menggantikan yang lama (design system, komponen Toast).
export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const timer = useRef();

  const show = useCallback((message, { action, success = true, duration = 4000 } = {}) => {
    clearTimeout(timer.current);
    setToast({ id: Date.now(), message, action, success });
    timer.current = setTimeout(() => setToast(null), duration);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-4 z-[60]" aria-live="polite">
        <AnimatePresence mode="wait">
          {toast && (
            <motion.div
              key={toast.id}
              role="status"
              className="pointer-events-auto flex min-h-10 max-w-[420px] items-center gap-3 rounded-md bg-inverse py-2 pl-3 pr-2 text-[13px] leading-5 text-on-inverse shadow-float"
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1, transition: spring.bouncy }}
              exit={{ opacity: 0, y: 4, transition: exit }}
            >
              {toast.success && <Check size={16} strokeWidth={2} className="shrink-0 text-inverse-success" aria-hidden="true" />}
              <span className="pr-1">{toast.message}</span>
              {toast.action && (
                <button
                  type="button"
                  className="ml-auto h-6 rounded-xs border border-current px-2 text-xs font-semibold opacity-85 hover:opacity-100"
                  onClick={() => {
                    toast.action.onClick();
                    setToast(null);
                  }}
                >
                  {toast.action.label}
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

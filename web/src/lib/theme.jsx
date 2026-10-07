import { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext(null);
const STORAGE_KEY = 'hdb-theme';

function readPreference() {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? 'system';
  } catch {
    return 'system';
  }
}

export function ThemeProvider({ children }) {
  const [preference, setPreference] = useState(readPreference);
  const [systemDark, setSystemDark] = useState(() => globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);

  useEffect(() => {
    const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return undefined;
    const onChange = (event) => setSystemDark(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const resolved = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
  }, [resolved]);

  const choose = (value) => {
    setPreference(value);
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Preferensi tema cuma kenyamanan; gagal simpan tidak apa-apa.
    }
  };

  return <ThemeContext.Provider value={{ preference, resolved, choose }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

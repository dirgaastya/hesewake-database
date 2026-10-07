import { useEffect, useId, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTheme } from '../lib/theme.jsx';
import { CodeEditor } from './Code.jsx';

// Mermaid berat (~1 MB), jadi dimuat hanya saat ada diagram.
function Mermaid({ code }) {
  const ref = useRef(null);
  const id = `mmd-${useId().replace(/[^a-z0-9]/gi, '')}`;
  const { resolved } = useTheme();
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    import('mermaid').then(async ({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: resolved === 'dark' ? 'dark' : 'neutral', fontFamily: 'Inter Variable, sans-serif' });
      try {
        const { svg } = await mermaid.render(id, code);
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
        setError('');
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [code, id, resolved]);

  if (error) return <pre className="m-0 whitespace-pre-wrap rounded-sm bg-danger-soft px-3 py-2 font-mono text-xs text-fg">Diagram tidak bisa dibaca: {error}</pre>;
  return <div ref={ref} className="overflow-x-auto rounded-sm bg-surface p-3 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full" />;
}

const components = {
  h1: (props) => <h3 className="mb-2 mt-5 text-base font-semibold first:mt-0" {...props} />,
  h2: (props) => <h4 className="mb-2 mt-5 text-sm font-semibold first:mt-0" {...props} />,
  h3: (props) => <h5 className="mb-1 mt-4 text-sm font-semibold first:mt-0" {...props} />,
  p: (props) => <p className="my-2 first:mt-0 last:mb-0" {...props} />,
  ul: (props) => <ul className="my-2 list-disc pl-5" {...props} />,
  ol: (props) => <ol className="my-2 list-decimal pl-5" {...props} />,
  li: (props) => <li className="my-0.5" {...props} />,
  a: (props) => <a className="text-accent-text underline decoration-1 underline-offset-2" target="_blank" rel="noreferrer noopener" {...props} />,
  blockquote: (props) => <blockquote className="my-2 border-l-2 border-line-strong pl-3 text-fg-muted" {...props} />,
  table: (props) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-[13px]" {...props} />
    </div>
  ),
  th: (props) => <th className="border-b border-line px-2 py-1 text-left font-semibold" {...props} />,
  td: (props) => <td className="border-b border-line px-2 py-1 align-top" {...props} />,
  hr: () => <hr className="my-4 border-line" />,
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => {
    const text = String(children).replace(/\n$/, '');
    const language = /language-(\w+)/.exec(className ?? '')?.[1];
    if (language === 'mermaid') return <Mermaid code={text} />;
    if (language || text.includes('\n')) {
      const map = { sql: 'sql', json: 'json', js: 'javascript', javascript: 'javascript', bash: 'shell', sh: 'shell', shell: 'shell', yaml: 'yaml', yml: 'yaml', env: 'properties', ini: 'properties' };
      return <CodeEditor value={text} language={map[language] ?? 'markdown'} readOnly minHeight="0" className="my-2" />;
    }
    return <code className="rounded-xs bg-surface-2 px-1 py-px font-mono text-[12.5px]">{children}</code>;
  },
};

export function Markdown({ children }) {
  return (
    <div className="min-w-0 max-w-[68ch] text-sm leading-[22px] text-fg">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

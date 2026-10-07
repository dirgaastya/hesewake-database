import { useMemo } from 'react';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { githubDark, githubLight } from '@uiw/codemirror-theme-github';
import { StreamLanguage } from '@codemirror/language';
import { sql } from '@codemirror/lang-sql';
import { json } from '@codemirror/lang-json';
import { javascript } from '@codemirror/lang-javascript';
import { markdown } from '@codemirror/lang-markdown';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { useTheme } from '../lib/theme.jsx';
import { cx } from './ui.jsx';

const LANGUAGES = {
  sql: () => sql(),
  json: () => json(),
  javascript: () => javascript(),
  markdown: () => markdown(),
  shell: () => StreamLanguage.define(shell),
  properties: () => StreamLanguage.define(properties),
  yaml: () => StreamLanguage.define(yaml),
};

const CONFIG_FORMATS = { json: 'json', yaml: 'yaml', yml: 'yaml', js: 'javascript', javascript: 'javascript', env: 'properties', ini: 'properties', properties: 'properties', conf: 'properties' };

export function languageFor(item) {
  if (item.type === 'query' || item.type === 'schema') return 'sql';
  if (item.type === 'command') return 'shell';
  if (item.type === 'config') return CONFIG_FORMATS[(item.metadata?.format ?? '').toLowerCase()] ?? 'properties';
  return 'markdown';
}

export function languageLabel(language) {
  return { sql: 'SQL', json: 'JSON', javascript: 'JavaScript', markdown: 'Markdown', shell: 'Shell', properties: 'Config', yaml: 'YAML' }[language] ?? language;
}

const baseTheme = EditorView.theme({
  '&': { fontSize: '13px', backgroundColor: 'transparent' },
  '.cm-content': { fontFamily: 'var(--font-mono)', padding: '12px 0' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--fg-subtle)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '20px' },
  '&.cm-focused': { outline: 'none' },
});

export function CodeEditor({ value, onChange, language = 'markdown', readOnly = false, minHeight = '120px', maxHeight, className, ariaLabel }) {
  const { resolved } = useTheme();
  const extensions = useMemo(() => [baseTheme, (LANGUAGES[language] ?? LANGUAGES.markdown)(), EditorView.lineWrapping], [language]);
  return (
    <div className={cx('min-w-0 overflow-hidden rounded-sm', readOnly ? 'bg-surface-2' : 'border border-line bg-surface focus-within:border-focus focus-within:ring-1 focus-within:ring-focus', className)}>
      <CodeMirror
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        editable={!readOnly}
        theme={resolved === 'dark' ? githubDark : githubLight}
        extensions={extensions}
        minHeight={minHeight}
        maxHeight={maxHeight}
        aria-label={ariaLabel}
        basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: !readOnly, highlightActiveLineGutter: !readOnly, autocompletion: !readOnly }}
      />
    </div>
  );
}

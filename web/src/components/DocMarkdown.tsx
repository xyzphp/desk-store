import { useMemo, useState, type MouseEvent } from 'react';
import { Icon, MarkdownView } from '@xyzos/desk-ui';
import { useStoreToast } from './ToastContext';

export interface DocHeading {
  id: string;
  level: 2 | 3;
  text: string;
}

type DocBlock =
  | { kind: 'markdown'; value: string }
  | { kind: 'heading'; id: string; level: 2 | 3; text: string }
  | { kind: 'code'; lang: string; code: string };

const languageLabels: Record<string, string> = {
  sh: 'TERMINAL · bash',
  bash: 'TERMINAL · bash',
  shell: 'TERMINAL · sh',
  powershell: 'TERMINAL · pwsh',
  pwsh: 'TERMINAL · pwsh',
  json: 'JSON',
  js: 'JavaScript',
  ts: 'TypeScript',
  tsx: 'TSX',
  go: 'Go',
  sql: 'SQL',
  html: 'HTML',
  css: 'CSS',
  yaml: 'YAML',
  yml: 'YAML',
  md: 'Markdown',
  markdown: 'Markdown',
  text: 'TEXT',
  txt: 'TEXT',
  http: 'HTTP',
  nginx: 'Nginx',
};

function stripInlineFormatting(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~]+/g, '')
    .trim();
}

function headingAnchorId(text: string, index: number, used: Set<string>): string {
  const base = stripInlineFormatting(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 48);
  const candidate = base ? `sec-${base}` : `sec-${index + 1}`;
  if (!used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  let suffix = 2;
  while (used.has(`${candidate}-${suffix}`)) suffix += 1;
  const unique = `${candidate}-${suffix}`;
  used.add(unique);
  return unique;
}

/** 将文档 Markdown 拆分为标题、围栏代码块与普通段落块，兼顾安全渲染、锚点目录与代码一键复制。 */
export function parseDocContent(markdown: string): { blocks: DocBlock[]; headings: DocHeading[] } {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: DocBlock[] = [];
  const headings: DocHeading[] = [];
  const usedIds = new Set<string>();
  let buffer: string[] = [];

  const flushMarkdown = () => {
    const chunk = buffer.join('\n').trim();
    if (chunk) blocks.push({ kind: 'markdown', value: chunk });
    buffer = [];
  };

  for (let i = 0; i < lines.length; ) {
    const line = lines[i]!;
    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})\s*([\w.+-]*)\s*$/);
    if (fence) {
      flushMarkdown();
      const marker = fence[1]!;
      const lang = (fence[2] ?? '').trim();
      const codeLines: string[] = [];
      i += 1;
      const closePattern = new RegExp(`^\\s{0,3}${marker[0]}{${marker.length},}\\s*$`);
      while (i < lines.length && !closePattern.test(lines[i]!)) {
        codeLines.push(lines[i]!);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ kind: 'code', lang, code: codeLines.join('\n') });
      continue;
    }

    const heading = line.match(/^(#{2,3})\s+(.+?)\s*#*$/);
    if (heading) {
      flushMarkdown();
      const level = heading[1]!.length as 2 | 3;
      const plain = stripInlineFormatting(heading[2]!);
      const id = headingAnchorId(plain, headings.length, usedIds);
      headings.push({ id, level, text: plain });
      blocks.push({ kind: 'heading', id, level, text: plain });
      i += 1;
      continue;
    }

    buffer.push(line);
    i += 1;
  }

  flushMarkdown();
  return { blocks, headings };
}

function DocCodeBox({ lang, code }: { lang: string; code: string }) {
  const { copyText } = useStoreToast();
  const [copied, setCopied] = useState(false);
  const label = languageLabels[lang.toLowerCase()] ?? (lang ? lang.toUpperCase() : 'CODE');

  const handleCopy = async () => {
    try {
      await copyText(code, '代码已复制');
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // ToastContext 已提示失败原因。
    }
  };

  return (
    <div className="store-codebox">
      <div className="store-codehead">
        <span>{label}</span>
        <button type="button" className="store-code-copy" onClick={() => void handleCopy()}>
          <Icon name={copied ? 'check' : 'copy'} size={13} />
          <span>{copied ? '已复制' : '复制代码'}</span>
        </button>
      </div>
      <pre tabIndex={0}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** 文档正文渲染器：站内文档/应用链接在当前页切换，代码块带语言标头和一键复制，标题带目录锚点。 */
export function DocMarkdown({ value }: { value: string }) {
  const { blocks } = useMemo(() => parseDocContent(value), [value]);

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement | null)?.closest('a');
    if (!anchor) return;
    const hrefAttr = anchor.getAttribute('href') ?? '';
    if (hrefAttr.startsWith('#/')) {
      event.preventDefault();
      window.location.hash = hrefAttr;
    }
  };

  return (
    <div className="store-doc-flow" onClick={handleClick}>
      {blocks.map((block, index) => {
        if (block.kind === 'heading') {
          if (block.level === 2) {
            return (
              <h2 key={block.id} id={block.id} className="store-doc-h2">
                {block.text}
              </h2>
            );
          }
          return (
            <h3 key={block.id} id={block.id} className="store-doc-h3">
              {block.text}
            </h3>
          );
        }
        if (block.kind === 'code') {
          return <DocCodeBox key={`code-${index}`} lang={block.lang} code={block.code} />;
        }
        return <MarkdownView key={`md-${index}`} as="div" className="store-markdown" value={block.value} />;
      })}
    </div>
  );
}

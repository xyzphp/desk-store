import { createElement, useMemo, type ComponentProps, type ElementType, type ReactNode, type Ref } from 'react';
import { cx, useLabels, type MarkdownMedia } from '@xyzos/desk-ui';

export interface SandboxMarkdownViewProps extends Omit<ComponentProps<'article'>, 'children' | 'ref'> {
  ref?: Ref<HTMLElement>;
  as?: 'article' | 'div';
  value: string;
  after?: ReactNode;
  media?: Readonly<Record<string, MarkdownMedia>>;
  editable?: boolean;
  visualEditable?: boolean;
}

const escapeHtml = (value: string) =>
  String(value).replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );

function safeLink(value: string) {
  if (!/^(https?:\/\/|\/(?!\/)|#)/i.test(value) || /[\s\\\u0000-\u001f]/.test(value)) return '';
  try {
    const url = new URL(value, 'https://markdown.example/');
    return ['http:', 'https:'].includes(url.protocol) ? value : '';
  } catch {
    return '';
  }
}

function safeMediaSrc(value: string) {
  if (/^blob:[^\s\\\u0000-\u001f]+$/i.test(value)) return value;
  if (/^\/(?!\/)[^\s\\\u0000-\u001f]*$/.test(value)) return safeLink(value);
  return '';
}

function renderSandboxMarkdown(
  value: string,
  options: {
    media?: Readonly<Record<string, MarkdownMedia>>;
    editable?: boolean;
    taskLabels: { done: string; pending: string };
  },
) {
  const taskLabels = options.taskLabels;

  function inline(source: string, depth = 0): string {
    let result = '';
    for (let index = 0; index < source.length; ) {
      const rest = source.slice(index);
      if (rest[0] === '\\' && /^[\\`*_~\[\]<>!#()+.|{}-]/.test(rest[1] || '')) {
        result += escapeHtml(rest[1]!);
        index += 2;
        continue;
      }
      if (rest[0] === '`') {
        const marker = rest.match(/^`+/)![0];
        const end = source.indexOf(marker, index + marker.length);
        if (end >= 0) {
          result += '<code>' + escapeHtml(source.slice(index + marker.length, end)) + '</code>';
          index = end + marker.length;
          continue;
        }
      }
      const link = rest.match(
        /^(!?)\[([^\]\r\n]+)\]\(([^\s)]+)(?:[ \t]+"([^"\r\n]*)")?(?:[ \t]+=(\d{2,4}))?(?:[ \t]+row=([1-4]))?\)/,
      );
      if (link) {
        const media = options.media && Object.hasOwn(options.media, link[3]!) ? options.media[link[3]!] : null;
        const mediaURL = media ? safeMediaSrc(media.url) : '';
        if (link[1] && mediaURL && media?.image) {
          const size = Number(link[5]) >= 80 && Number(link[5]) <= 1200 ? Number(link[5]) : 0;
          const columns = Number(link[6]) || 1;
          const width = size ? ' width="' + size + '"' : '';
          const title = link[4] ? ' title="' + escapeHtml(link[4]) + '"' : '';
          const img =
            '<img src="' +
            escapeHtml(mediaURL) +
            '" alt="' +
            escapeHtml(link[2]!) +
            '" data-md-file="' +
            escapeHtml(link[3]!) +
            '" data-md-columns="' +
            columns +
            '"' +
            width +
            title +
            ' loading="lazy" decoding="async">';
          result +=
            '<span class="markdown-image" data-md-image="' +
            escapeHtml(link[3]!) +
            '" data-md-columns="' +
            columns +
            '"' +
            (size ? ' style="width:' + size + 'px"' : '') +
            '>' +
            img +
            '</span>';
          index += link[0].length;
          continue;
        }
        const url = mediaURL || safeLink(link[3]!);
        const label = depth < 4 ? inline(link[2]!, depth + 1) : escapeHtml(link[2]!);
        result += url
          ? '<a href="' +
            escapeHtml(url) +
            '" target="_blank" rel="noopener noreferrer"' +
            (mediaURL ? ' data-md-file="' + escapeHtml(link[3]!) + '"' : '') +
            (link[4] ? ' title="' + escapeHtml(link[4]) + '"' : '') +
            '>' +
            label +
            '</a>'
          : label;
        index += link[0].length;
        continue;
      }
      let formatted = false;
      if (depth < 4) {
        for (const [marker, tag] of [
          ['**', 'strong'],
          ['__', 'strong'],
          ['~~', 'del'],
          ['*', 'em'],
          ['_', 'em'],
        ] as const) {
          if (!rest.startsWith(marker)) continue;
          const end = source.indexOf(marker, index + marker.length);
          if (end > index + marker.length) {
            result += '<' + tag + '>' + inline(source.slice(index + marker.length, end), depth + 1) + '</' + tag + '>';
            index = end + marker.length;
            formatted = true;
            break;
          }
        }
      }
      if (formatted) continue;
      result += escapeHtml(rest[0]!);
      index++;
    }
    return result;
  }

  function renderParagraph(paragraphLines: string[], start: number, end: number) {
    const trimmed = paragraphLines.map((l) => l.trim()).filter(Boolean);
    const images = trimmed.map((l) =>
      l.match(/^!\[([^\]\r\n]+)\]\(([^\s)]+)(?:[ \t]+"([^"\r\n]*)")?(?:[ \t]+=(\d{2,4}))?(?:[ \t]+row=([1-4]))?\)$/),
    );
    const rowCols = Number(images[0]?.[5]) || 1;
    const allImages =
      trimmed.length > 0 &&
      images.every((m) => {
        if (!m) return false;
        const entry = options.media && Object.hasOwn(options.media, m[2]!) ? options.media[m[2]!] : null;
        return !!entry?.image && !!safeMediaSrc(entry.url);
      });
    const attrs = options.editable ? ` data-md-start="${start}" data-md-end="${end}"` : '';
    if (allImages && rowCols >= 2 && rowCols <= 4 && trimmed.length >= 2) {
      return `<div class="markdown-image-row" data-md-columns="${rowCols}"${attrs}>${trimmed.map((l) => inline(l)).join('')}</div>`;
    }
    return `<p${attrs}>${paragraphLines.map((l) => inline(l)).join('<br>')}</p>`;
  }

  const lines = String(value || '').replace(/\r\n?/g, '\n').split('\n');
  const offsets: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    offsets.push(cursor);
    cursor += line.length + 1;
  }
  const blockEnd = (idx: number) => offsets[idx]! + lines[idx]!.length;

  const out: string[] = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const start = offsets[i]!;
    const fence = line.match(/^(`{3,}|~{3,})([\w+-]*)\s*$/);
    if (fence) {
      const marker = fence[1]!;
      const lang = fence[2] || '';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith(marker)) {
        codeLines.push(lines[i]!);
        i++;
      }
      const end = i < lines.length ? blockEnd(i) : blockEnd(lines.length - 1);
      if (i < lines.length) i++;
      const attrs = options.editable ? ` data-md-start="${start}" data-md-end="${end}"` : '';
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      out.push(`<pre${attrs}><code${cls}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1]!.length;
      const attrs = options.editable ? ` data-md-start="${start}" data-md-end="${blockEnd(i)}"` : '';
      out.push(`<h${level}${attrs}>${inline(heading[2]!.trim())}</h${level}>`);
      i++;
      continue;
    }
    if (/^(?:\s*[-*_]\s*){3,}$/.test(line)) {
      const attrs = options.editable ? ` data-md-start="${start}" data-md-end="${blockEnd(i)}"` : '';
      out.push(`<hr${attrs}>`);
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      const first = i;
      while (i < lines.length && /^>\s?/.test(lines[i]!)) {
        quoteLines.push(lines[i]!.replace(/^>\s?/, ''));
        i++;
      }
      const attrs = options.editable ? ` data-md-start="${offsets[first]!}" data-md-end="${blockEnd(i - 1)}"` : '';
      out.push(`<blockquote${attrs}>${renderSandboxMarkdown(quoteLines.join('\n'), { ...options, editable: false })}</blockquote>`);
      continue;
    }
    if (
      i + 1 < lines.length &&
      line.includes('|') &&
      /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(lines[i + 1]!)
    ) {
      const splitCells = (row: string) =>
        row
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split(/(?<!\\)\|/)
          .map((c) => c.trim().replace(/\\\|/g, '|'));
      const header = splitCells(line);
      const bodyRows: string[][] = [];
      const first = i;
      i += 2;
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim()) {
        bodyRows.push(splitCells(lines[i]!));
        i++;
      }
      const attrs = options.editable ? ` data-md-start="${offsets[first]!}" data-md-end="${blockEnd(i - 1)}"` : '';
      out.push(
        `<div class="markdown-table"${attrs}><table><thead><tr>${header.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${bodyRows
          .map((r) => `<tr>${header.map((_, idx) => `<td>${inline(r[idx] || '')}</td>`).join('')}</tr>`)
          .join('')}</tbody></table></div>`,
      );
      continue;
    }
    const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (listMatch) {
      const ordered = /\d+\./.test(listMatch[2]!);
      const tag = ordered ? 'ol' : 'ul';
      const items: string[] = [];
      const first = i;
      while (i < lines.length) {
        const m = lines[i]!.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
        if (!m || /\d+\./.test(m[2]!) !== ordered) break;
        const body = m[3]!;
        const task = body.match(/^\[( |x|X)\]\s+(.*)$/);
        if (task) {
          const done = task[1]!.toLowerCase() === 'x';
          items.push(
            `<li class="markdown-task"><span aria-label="${escapeHtml(done ? taskLabels.done : taskLabels.pending)}">${done ? '☑' : '☐'}</span>${inline(task[2]!)}</li>`,
          );
        } else {
          items.push(`<li>${inline(body)}</li>`);
        }
        i++;
      }
      const attrs = options.editable ? ` data-md-start="${offsets[first]!}" data-md-end="${blockEnd(i - 1)}"` : '';
      out.push(`<${tag}${attrs}>${items.join('')}</${tag}>`);
      continue;
    }
    const paraLines: string[] = [];
    const first = i;
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !/^(`{3,}|~{3,})/.test(lines[i]!) &&
      !/^(#{1,6})\s+/.test(lines[i]!) &&
      !/^>\s?/.test(lines[i]!) &&
      !/^(\s*)([-*+]|\d+\.)\s+/.test(lines[i]!)
    ) {
      paraLines.push(lines[i]!);
      i++;
    }
    out.push(renderParagraph(paraLines, offsets[first]!, blockEnd(i - 1)));
  }
  return out.join('\n');
}

const allowedTags = new Set([
  'a', 'blockquote', 'br', 'code', 'del', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'img', 'li', 'ol',
  'p', 'pre', 'span', 'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul',
]);
const mediaReference = /^(?:article|project)-file:[1-9]\d*$/;
const safeClass = /^(?:markdown-table|markdown-task|markdown-image|markdown-image-row|language-[\w+-]+)$/;

function dataNumber(element: Element, attribute: string) {
  const value = element.getAttribute(attribute);
  if (!value || !/^\d{1,5}$/.test(value)) return undefined;
  const num = Number(value);
  return Number.isSafeInteger(num) && num <= 80_000 ? num : undefined;
}

function toReact(
  node: Node,
  key: string,
  visualEditable: boolean,
  labels: ReturnType<typeof useLabels>,
): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const element = node as HTMLElement;
  const tag = element.tagName.toLocaleLowerCase();
  if (!allowedTags.has(tag)) {
    return Array.from(element.childNodes, (child, index) => toReact(child, `${key}.${index}`, visualEditable, labels));
  }
  const props: Record<string, unknown> = { key };
  const className = element
    .getAttribute('class')
    ?.split(/\s+/)
    .filter((v) => safeClass.test(v))
    .join(' ');
  if (className) props.className = className;
  const title = element.getAttribute('title');
  if (title) props.title = title.slice(0, 500);
  const label = element.getAttribute('aria-label');
  if (label === labels.task.done || label === labels.task.pending) props['aria-label'] = label;
  const mediaFile = element.getAttribute('data-md-file');
  if (mediaFile && mediaReference.test(mediaFile)) props['data-md-file'] = mediaFile;
  const imageReference = element.getAttribute('data-md-image');
  if (imageReference && mediaReference.test(imageReference)) props['data-md-image'] = imageReference;
  const columns = Number(element.getAttribute('data-md-columns'));
  if (Number.isInteger(columns) && columns >= 1 && columns <= 4) props['data-md-columns'] = String(columns);
  const start = dataNumber(element, 'data-md-start');
  const end = dataNumber(element, 'data-md-end');
  if (start !== undefined && end !== undefined && end >= start) {
    props['data-md-start'] = start;
    props['data-md-end'] = end;
  }
  if (tag === 'a') {
    const href = safeLink(element.getAttribute('href') || '');
    if (!href) {
      return Array.from(element.childNodes, (child, index) => toReact(child, `${key}.${index}`, visualEditable, labels));
    }
    props.href = href;
    props.target = '_blank';
    props.rel = 'noopener noreferrer';
  }
  if (tag === 'img') {
    const src = safeMediaSrc(element.getAttribute('src') || '');
    if (!src) return null;
    props.src = src;
    props.alt = (element.getAttribute('alt') || '').slice(0, 1000);
    props.loading = 'lazy';
    props.decoding = 'async';
    const width = Number(element.getAttribute('width'));
    if (Number.isInteger(width) && width >= 80 && width <= 1200) props.width = width;
  }
  if (tag === 'span') {
    const width = element.style.width;
    if (/^(?:[8-9]\d|[1-9]\d{2}|1[01]\d{2}|1200)px$/.test(width)) props.style = { width };
    if (visualEditable && className?.split(/\s+/).includes('markdown-image')) {
      const image = element.querySelector('img');
      props.contentEditable = false;
      props.tabIndex = 0;
      props['aria-label'] = labels.imageHint(image?.getAttribute('alt') || labels.image);
    }
  }
  const children = Array.from(element.childNodes, (child, index) =>
    toReact(child, `${key}.${index}`, visualEditable, labels),
  );
  if (visualEditable && tag === 'span' && className?.split(/\s+/).includes('markdown-image')) {
    const imageWidth = Number(element.querySelector('img')?.getAttribute('width'));
    children.push(
      createElement('button', {
        key: `${key}.resize`,
        type: 'button',
        className: 'md-editor-image-resize',
        'data-md-image-resize': '',
        'data-md-editor-ui': '',
        role: 'slider',
        tabIndex: 0,
        'aria-label': labels.resizeImage,
        'aria-valuemin': 80,
        'aria-valuemax': 1200,
        'aria-valuenow': Number.isInteger(imageWidth) && imageWidth >= 80 && imageWidth <= 1200 ? imageWidth : 320,
      }),
    );
  }
  return createElement(tag, props, ...children);
}

export function SandboxMarkdownView({
  as = 'article',
  value,
  media,
  editable = false,
  visualEditable = false,
  after,
  className,
  ...rest
}: SandboxMarkdownViewProps) {
  const labels = useLabels('markdownView');
  const content = useMemo(() => {
    const markup = renderSandboxMarkdown(value, { media, editable, taskLabels: labels.task });
    if (typeof DOMParser === 'undefined') return value.slice(0, 80_000);
    const parsed = new DOMParser().parseFromString(markup, 'text/html');
    return Array.from(parsed.body.childNodes, (node, index) => toReact(node, String(index), visualEditable, labels));
  }, [editable, labels, media, value, visualEditable]);
  const Root = as as ElementType;
  const children = typeof content === 'string' ? createElement('pre', null, content) : content;
  const props = { ...rest, suppressContentEditableWarning: visualEditable, className: cx('ds-markdown', className) };
  return after === undefined ? createElement(Root, props, children) : createElement(Root, props, children, after);
}

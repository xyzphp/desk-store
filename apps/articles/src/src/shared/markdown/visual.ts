import { locales } from '@xyzos/desk-ui';
import { markdownText } from './locale';

/** 任务标记的可访问名称由组件库按界面语言生成，这里认得所有已登记语言的“已完成”。 */
const doneLabels = () => locales.map((locale) => locale.labels.markdownView.task.done);
export interface MarkdownVisualMedia {
  url: string;
  image: boolean;
}

export interface MarkdownVisualSelection {
  value: string;
  start: number;
  end: number;
}

export type MarkdownVisualBlockPreserver = (element: Element) => string | undefined;

const mediaReference = /^(?:article|project)-file:[1-9]\d*$/;
const imageLink =
  /!\[([^\]\r\n]+)\]\(((?:article|project)-file:[1-9]\d*)(?:[ \t]+"([^"\r\n]*)")?(?:[ \t]+=(\d{2,4}))?(?:[ \t]+row=([1-4]))?\)/g;
const escapeText = (value: string) => String(value).replace(/([\\`*_{}\[\]()#+.!>|~-])/g, '\\$1');
const children = (node: Node) => Array.from(node.childNodes);
const tag = (node: Node) => (node.nodeType === Node.ELEMENT_NODE ? (node as Element).tagName.toUpperCase() : '');
const isBlock = (node: Node) => /^(P|H[1-6]|BLOCKQUOTE|UL|OL|PRE|HR|DIV|TABLE)$/.test(tag(node));

function safeHref(value: string) {
  if (!/^(https?:\/\/|\/(?!\/)|#)/i.test(value) || /[\s\\\u0000-\u001f]/.test(value)) return '';
  try {
    const url = new URL(value, 'https://markdown.example/');
    return ['http:', 'https:'].includes(url.protocol) ? value : '';
  } catch {
    return '';
  }
}

export function serializeVisualMarkdown(
  root: Node,
  media: Readonly<Record<string, MarkdownVisualMedia>>,
  preserve?: MarkdownVisualBlockPreserver,
) {
  const textContent = (node: Node): string =>
    node.nodeType === Node.TEXT_NODE ? node.nodeValue || '' : children(node).map(textContent).join('');
  const safeLink = (value: string) => {
    const href = safeHref(value);
    return href ? href.replace(/[()]/g, (character) => (character === '(' ? '%28' : '%29')) : '';
  };
  const boundReference = (node: Element, attribute: 'href' | 'src') => {
    const reference = node.getAttribute('data-md-file') || '';
    const target = mediaReference.test(reference) ? media[reference] : undefined;
    const validTarget =
      !!target && (/^blob:[^\s\\\u0000-\u001f]+$/i.test(target.url) || (/^\/(?!\/)/.test(target.url) && !!safeHref(target.url)));
    return validTarget && node.getAttribute(attribute) === target!.url ? reference : '';
  };

  function inline(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return escapeText(node.nodeValue || '');
    const name = tag(node);
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const element = node as Element;
    if (element.hasAttribute('data-md-editor-ui') || /^(SCRIPT|STYLE|IFRAME|OBJECT|SVG)$/.test(name)) return '';
    if (name === 'BR') return '\n';
    if (name === 'IMG') {
      const reference = boundReference(element, 'src');
      const alt =
        String(element.getAttribute('alt') || markdownText().image)
          .replace(/[\\[\]\r\n]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim() || markdownText().image;
      if (!reference) return escapeText(element.getAttribute('alt') || '');
      const width = Number(element.getAttribute('width'));
      const size = Number.isInteger(width) && width >= 80 && width <= 1200 ? ` =${width}` : '';
      const columns = Number(element.getAttribute('data-md-columns'));
      const row = Number.isInteger(columns) && columns >= 2 && columns <= 4 ? ` row=${columns}` : '';
      const title = String(element.getAttribute('title') || '').replace(/["\r\n]/g, ' ');
      return `![${alt}](${reference}${title ? ` "${title}"` : ''}${size}${row})`;
    }
    if (name === 'A') {
      const label = children(element).map(inline).join('');
      const href = boundReference(element, 'href') || safeLink(element.getAttribute('href') || '');
      const title = String(element.getAttribute('title') || '').replace(/["\r\n]/g, ' ');
      return href ? `[${label}](${href}${title ? ` "${title}"` : ''})` : label;
    }
    if (element.classList.contains('markdown-image-row'))
      return children(element).map(inline).filter(Boolean).join('\n');
    const content = children(element).map(inline).join('');
    if (name === 'STRONG' || name === 'B') return `**${content}**`;
    if (name === 'EM' || name === 'I') return `*${content}*`;
    if (name === 'DEL' || name === 'S' || name === 'STRIKE') return `~~${content}~~`;
    if (name === 'CODE') {
      const value = textContent(element);
      const marker = '`'.repeat(Math.max(1, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length + 1)));
      return `${marker}${value}${marker}`;
    }
    return content;
  }

  function table(node: Element) {
    const rows: Element[] = [];
    const visit = (current: Node) => {
      for (const child of children(current)) {
        if (tag(child) === 'TR') rows.push(child as Element);
        else visit(child);
      }
    };
    visit(node);
    if (!rows.length) return '';
    const cellsFor = (row: Element) =>
      children(row)
        .filter((cell) => /^(TH|TD)$/.test(tag(cell)))
        .map((cell) => inline(cell).replace(/\\\|/g, '|').replace(/\|/g, '\\|').replace(/\n/g, ' '));
    const header = cellsFor(rows[0]!);
    if (!header.length) return '';
    return [
      `| ${header.join(' | ')} |`,
      `| ${header.map(() => '---').join(' | ')} |`,
      ...rows.slice(1).map((row) => {
        const cells = cellsFor(row);
        return `| ${header.map((_, index) => cells[index] || '').join(' | ')} |`;
      }),
    ].join('\n');
  }

  function list(node: Element, depth = 0) {
    const ordered = tag(node) === 'OL';
    const marker = (index: number) => (ordered ? `${index + 1}. ` : '- ');
    return children(node)
      .filter((item) => tag(item) === 'LI')
      .map((item, index) => {
        const itemChildren = children(item);
        const task =
          item instanceof Element && item.classList.contains('markdown-task')
            ? itemChildren.find((child) => tag(child) === 'SPAN' && (child as Element).hasAttribute('aria-label'))
            : undefined;
        const content = itemChildren
          .filter((child) => child !== task)
          .map((child) => (isBlock(child) ? blocks(child, depth + 1) : inline(child)))
          .join('')
          .trim();
        const taskPrefix = task
          ? doneLabels().includes((task as Element).getAttribute('aria-label') ?? '')
            ? '[x] '
            : '[ ] '
          : '';
        return `${'  '.repeat(Math.min(depth, 6))}${marker(index)}${taskPrefix}${content}`;
      })
      .join('\n');
  }

  function block(node: Node, depth = 0) {
    const element = node as Element;
    const saved = node.nodeType === Node.ELEMENT_NODE ? preserve?.(element) : undefined;
    if (saved !== undefined) return saved;
    const name = tag(node);
    if (/^H[1-6]$/.test(name)) return `${'#'.repeat(Number(name[1]))} ${children(node).map(inline).join('').trim()}`;
    if (name === 'P') return children(node).map(inline).join('').trim();
    if (name === 'DIV') return blocks(node, depth);
    if (name === 'HR') return '---';
    if (name === 'UL' || name === 'OL') return list(element, depth);
    if (name === 'TABLE') return table(element);
    if (name === 'BLOCKQUOTE') {
      const value = blocks(node, depth + 1);
      return value
        ? value
            .split('\n')
            .map((line) => `> ${line}`)
            .join('\n')
        : '';
    }
    if (name === 'PRE') {
      const code = children(node).find((child) => tag(child) === 'CODE');
      const value = textContent(code || node).replace(/\n+$/, '');
      const marker = '`'.repeat(Math.max(3, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length + 1)));
      const language =
        String((code && (code as Element).getAttribute('class')) || '').match(/(?:^|\s)language-([\w+-]+)/)?.[1] || '';
      return `${marker}${language}\n${value}\n${marker}`;
    }
    return children(node).map(inline).join('').trim();
  }

  function blocks(node: Node, depth = 0) {
    const output: string[] = [];
    let inlineNodes: Node[] = [];
    const flush = () => {
      if (!inlineNodes.length) return;
      const value = inlineNodes.map(inline).join('').trim();
      if (value) output.push(value);
      inlineNodes = [];
    };
    for (const child of children(node)) {
      if (isBlock(child)) {
        flush();
        const value = block(child, depth);
        if (value) output.push(value);
      } else inlineNodes.push(child);
    }
    flush();
    return output.join('\n\n');
  }

  return blocks(root)
    .trim()
    .replace(/\n{3,}/g, '\n\n');
}

export function normalizeVisualMarkdownBlock(element: Element, media: Readonly<Record<string, MarkdownVisualMedia>>) {
  const wrapper = element.ownerDocument.createElement('div');
  wrapper.append(element.cloneNode(true));
  return serializeVisualMarkdown(wrapper, media);
}

export function serializeVisualMarkdownSelection(
  root: HTMLElement,
  media: Readonly<Record<string, MarkdownVisualMedia>>,
  preserve?: MarkdownVisualBlockPreserver,
): MarkdownVisualSelection {
  const selection = root.ownerDocument.getSelection();
  const fallback = serializeVisualMarkdown(root, media, preserve);
  if (!selection?.rangeCount || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode))
    return { value: fallback, start: fallback.length, end: fallback.length };
  const range = selection.getRangeAt(0).cloneRange();
  const backward = selection.anchorNode === range.endContainer && selection.anchorOffset === range.endOffset;
  const id = Math.random().toString(36).slice(2);
  const startMarker = `\ue000${id}\ue001`;
  const endMarker = `\ue002${id}\ue003`;
  const startNode = root.ownerDocument.createTextNode(startMarker);
  const endNode = root.ownerDocument.createTextNode(endMarker);
  let restored: Range | undefined;
  let marked = '';
  try {
    const endRange = range.cloneRange();
    endRange.collapse(false);
    endRange.insertNode(endNode);
    const startRange = range.cloneRange();
    startRange.collapse(true);
    startRange.insertNode(startNode);
    restored = startRange.cloneRange();
    restored.setStartAfter(startNode);
    restored.setEndBefore(endNode);
    marked = serializeVisualMarkdown(root, media, preserve);
  } finally {
    startNode.remove();
    endNode.remove();
    if (restored) {
      selection.removeAllRanges();
      selection.addRange(restored);
      if (backward)
        selection.setBaseAndExtent?.(
          restored.endContainer,
          restored.endOffset,
          restored.startContainer,
          restored.startOffset,
        );
    }
  }
  const start = marked.indexOf(startMarker);
  const markerEnd = marked.indexOf(endMarker);
  if (start < 0 || markerEnd < start) return { value: fallback, start: fallback.length, end: fallback.length };
  return {
    value: marked.replace(startMarker, '').replace(endMarker, ''),
    start,
    end: markerEnd - startMarker.length,
  };
}

export function updateVisualMarkdownImages(
  source: string,
  media: Readonly<Record<string, MarkdownVisualMedia>>,
  imageIndex: number,
  groupIndexes: readonly number[],
  change: { width?: number; columns?: number },
) {
  const group = new Set(groupIndexes);
  let index = 0;
  const updated = source.replace(
    imageLink,
    (match, alt: string, reference: string, title: string, width: string, columns: string) => {
      if (!media[reference]?.image) return match;
      const current = index++;
      const nextWidth = current === imageIndex && change.width !== undefined ? change.width : Number(width) || 0;
      const nextColumns = group.has(current) && change.columns !== undefined ? change.columns : Number(columns) || 1;
      const size = nextWidth >= 80 && nextWidth <= 1200 ? ` =${nextWidth}` : '';
      const row = nextColumns >= 2 && nextColumns <= 4 ? ` row=${nextColumns}` : '';
      return `![${alt}](${reference}${title ? ` "${title}"` : ''}${size}${row})`;
    },
  );
  return change.columns && change.columns > 1 ? mergeImageOnlyParagraphs(updated, media, group) : updated;
}

function mergeImageOnlyParagraphs(
  source: string,
  media: Readonly<Record<string, MarkdownVisualMedia>>,
  group: ReadonlySet<number>,
) {
  if (group.size < 2) return source;
  const matches: { start: number; end: number; index: number }[] = [];
  let index = 0;
  for (const match of source.matchAll(new RegExp(imageLink.source, 'g'))) {
    if (!media[match[2] || '']?.image) continue;
    matches.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length, index: index++ });
  }
  if (!matches.length) return source;
  const parts = source.split(/(\n{2,})/);
  const imageOnly: boolean[] = [];
  let offset = 0;
  for (let part = 0; part < parts.length; part += 2) {
    const text = parts[part] || '';
    const end = offset + text.length;
    const inParagraph = matches.filter((match) => match.start >= offset && match.end <= end);
    let remainder = text;
    for (const match of [...inParagraph].reverse())
      remainder = `${remainder.slice(0, match.start - offset)}${remainder.slice(match.end - offset)}`;
    const paragraphIndexes = inParagraph.map((match) => match.index);
    imageOnly.push(
      !!paragraphIndexes.length && !remainder.trim() && paragraphIndexes.every((value) => group.has(value)),
    );
    offset = end + (parts[part + 1]?.length || 0);
  }
  for (let paragraph = 0; paragraph < imageOnly.length - 1; paragraph++) {
    if (!imageOnly[paragraph] || !imageOnly[paragraph + 1]) continue;
    const separator = paragraph * 2 + 1;
    if (parts[separator]) parts[separator] = '\n';
  }
  return parts.join('');
}

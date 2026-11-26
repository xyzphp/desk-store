// 极简 Markdown 渲染：只生成 React 元素，不拼接 HTML，文件内容不会作为脚本或标签执行。
// 支持标题、段落、无序 / 有序列表、引用、代码块、分隔线，以及行内代码、粗体、斜体与链接（显示为文字和地址）。
import { createElement as h, Fragment } from 'react';

const inlinePattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)\s]+\))/g;

function inline(text, keyPrefix) {
  return text.split(inlinePattern).map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (/^`[^`]+`$/.test(part)) return h('code', { key }, part.slice(1, -1));
    if (/^\*\*[^*]+\*\*$/.test(part)) return h('strong', { key }, part.slice(2, -2));
    if (/^\*[^*\s][^*]*\*$/.test(part)) return h('em', { key }, part.slice(1, -1));
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    // 沙箱页面不能打开新窗口，链接只显示文字与地址，由用户自行复制。
    if (link) return h('span', { key, className: 'md-link', title: link[2] }, `${link[1]}（${link[2]}）`);
    return h(Fragment, { key }, part);
  });
}

export function renderMarkdown(source) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let index = 0;
  const key = () => `b${blocks.length}`;
  while (index < lines.length) {
    const line = lines[index];
    if (/^```/.test(line)) {
      const code = [];
      index++;
      while (index < lines.length && !/^```/.test(lines[index])) code.push(lines[index++]);
      index++;
      blocks.push(h('pre', { key: key() }, h('code', null, code.join('\n'))));
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(h(`h${heading[1].length}`, { key: key() }, inline(heading[2], key())));
      index++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push(h('hr', { key: key() }));
      index++;
      continue;
    }
    const listMatch = /^\s*([-*+]|\d+[.)])\s+/.exec(line);
    if (listMatch) {
      const ordered = /\d/.test(listMatch[1]);
      const items = [];
      while (index < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[index])) {
        const text = lines[index].replace(/^\s*([-*+]|\d+[.)])\s+/, '');
        items.push(h('li', { key: `${key()}-${items.length}` }, inline(text, `${key()}-${items.length}`)));
        index++;
      }
      blocks.push(h(ordered ? 'ol' : 'ul', { key: key() }, items));
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ''));
      blocks.push(h('blockquote', { key: key() }, inline(quote.join(' '), key())));
      continue;
    }
    if (!line.trim()) {
      index++;
      continue;
    }
    const paragraph = [];
    while (index < lines.length && lines[index].trim() && !/^(```|#{1,6}\s|>|\s*([-*+]|\d+[.)])\s)/.test(lines[index]))
      paragraph.push(lines[index++].trim());
    // 兜底：任何未识别的行至少前进一行，避免死循环。
    if (!paragraph.length) paragraph.push(lines[index++].trim());
    blocks.push(h('p', { key: key() }, inline(paragraph.join(' '), key())));
  }
  return blocks;
}

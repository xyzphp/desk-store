// 主页面：显示当前用户、读取应用设置，打开“用…打开”传入或用户选择的 Markdown 文件。
// 组件来自系统托管的 @xyzos/desk-ui（index.html 中的 <meta name="xyzos-desk-ui">），不需要构建步骤。
import { createElement as h, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, ConfigProvider, EmptyState, Inline, Notice, Stack, Text, Workspace } from '@xyzos/desk-ui';
import { locale, on, permissions, platform } from './bridge.js';
import { renderMarkdown } from './markdown.js';

const maxBytes = 2 << 20;
const defaults = { font_size: 'medium', wrap_code: true, empty_hint: '' };

/** 用一次性读取地址取回文件内容；地址 10 分钟内有效且只能读一次。 */
async function readFile(file) {
  if (file.size > maxBytes) throw new Error('文件超过 2 MB，本示例不打开');
  const response = await fetch(file.url);
  if (!response.ok) throw new Error(response.status === 403 ? '读取地址已失效，请重新打开文件' : '读取文件失败');
  return { name: file.name, text: await response.text() };
}

function App() {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState('');
  const [settings, setSettings] = useState(defaults);
  const [lastFile, setLastFile] = useState('');
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [canRemind, setCanRemind] = useState(false);
  const [lang, setLang] = useState('zh-CN');

  const open = (file) => {
    setBusy(true);
    setError('');
    readFile(file)
      .then((next) => {
        setDoc(next);
        setLastFile(next.name);
        return platform('workspace.state', 'save', { lastFile: next.name });
      })
      .catch((failure) => setError(failure.message))
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    on('init', () => {
      setReady(true);
      setCanRemind(permissions().includes('remind'));
      setLang(locale());
      platform('identity', 'me').then((result) => setMe(result.displayName)).catch(() => {});
      platform('settings', 'get').then((values) => setSettings({ ...defaults, ...values })).catch(() => {});
      platform('workspace.state', 'get')
        .then((state) => setLastFile(state && typeof state.lastFile === 'string' ? state.lastFile : ''))
        .catch(() => {});
    });
    on('locale', setLang);
    on('openFile', open);
  }, []);

  const pick = () =>
    platform('files.pick', 'pick')
      .then((file) => file && open(file))
      .catch((failure) => setError(failure.message));

  const toolbar = h(
    Inline,
    { justify: 'between' },
    h(Text, { strong: true }, me ? `你好，${me}` : 'Markdown 阅读器'),
    h(
      Inline,
      null,
      canRemind && h(Button, { icon: 'clock-3', onClick: () => (window.location.href = 'remind/') }, '阅读提醒'),
      h(Button, { variant: 'primary', icon: 'folder-open', disabled: !ready || busy, onClick: pick }, '打开文件'),
    ),
  );
  const body = doc
    ? h(
        'article',
        { className: `md-doc md-${settings.font_size}${settings.wrap_code ? ' md-wrap' : ''}`, 'aria-label': doc.name },
        h(Text, { as: 'p', tone: 'muted', size: 'sm' }, doc.name),
        renderMarkdown(doc.text),
      )
    : h(
        EmptyState,
        null,
        ready ? settings.empty_hint || defaults.empty_hint || '还没有打开文件。' : '请在 XYZOS 中打开本应用。',
        lastFile ? `（上次打开：${lastFile}）` : '',
      );
  return h(
    ConfigProvider,
    { locale: lang },
    h(
      Workspace,
      { className: 'md-app' },
      h(Stack, { gap: 'md' }, toolbar, error && h(Notice, { tone: 'error' }, error), body),
    ),
  );
}

createRoot(document.getElementById('root')).render(h(App));

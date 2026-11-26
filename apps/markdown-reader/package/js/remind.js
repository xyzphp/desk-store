// 阅读提醒页：清单把 /remind/ 设为 permission:remind，没有该应用内权限的账号由系统直接拒绝打开本页。
// 页面用 notify 能力给自己发一条站内通知，点击通知会重新打开本应用。
import { createElement as h, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, ConfigProvider, Field, Inline, Input, Notice, Stack, Text, Workspace } from '@xyzos/desk-ui';
import { locale, on, platform } from './bridge.js';

function Remind() {
  const [title, setTitle] = useState('稍后阅读');
  const [body, setBody] = useState('');
  const [state, setState] = useState({ tone: '', text: '' });
  const [busy, setBusy] = useState(false);
  const [lang, setLang] = useState('zh-CN');
  useEffect(() => {
    on('init', () => setLang(locale()));
    on('locale', setLang);
  }, []);
  const send = (event) => {
    event.preventDefault();
    setBusy(true);
    platform('notify', 'send', { title: title.trim(), body: body.trim() })
      .then(() => {
        setState({ tone: 'success', text: '已发送，可在通知中心查看。' });
        return platform('ui', 'toast', { title: '提醒已发送', type: 'success' });
      })
      .catch((failure) => setState({ tone: 'error', text: failure.message }))
      .finally(() => setBusy(false));
  };
  return h(
    ConfigProvider,
    { locale: lang },
    h(
      Workspace,
      { className: 'md-app' },
      h(
        'form',
        { onSubmit: send },
        h(
          Stack,
          { gap: 'md' },
          h(Text, { as: 'h1', strong: true }, '给自己发阅读提醒'),
          state.text && h(Notice, { tone: state.tone }, state.text),
          h(Field, { label: '标题' }, h(Input, { value: title, maxLength: 100, required: true, onChange: (e) => setTitle(e.currentTarget.value) })),
          h(Field, { label: '内容（可选）' }, h(Input, { value: body, maxLength: 500, onChange: (e) => setBody(e.currentTarget.value) })),
          h(
            Inline,
            { justify: 'end' },
            h(Button, { icon: 'arrow-left', onClick: () => (window.location.href = '../') }, '返回'),
            h(Button, { type: 'submit', variant: 'primary', disabled: busy || !title.trim() }, '发送'),
          ),
        ),
      ),
    ),
  );
}

createRoot(document.getElementById('root')).render(h(Remind));

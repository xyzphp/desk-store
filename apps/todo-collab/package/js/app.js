import { createElement as h, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Button,
  Checkbox,
  ConfigProvider,
  EmptyState,
  Inline,
  Input,
  Notice,
  Select,
  Stack,
  Tag,
  Text,
  Workspace,
} from '@xyzos/desk-ui';
import { backendJSON, locale, on, permissions } from './bridge.js';

const priorityLabels = { high: '高', normal: '中', low: '低' };
const priorityTones = { high: 'danger', normal: 'neutral', low: 'success' };

function App() {
  const [ready, setReady] = useState(false);
  const [lang, setLang] = useState('zh-CN');
  const [perms, setPerms] = useState([]);
  const [state, setState] = useState({
    boards: [],
    tasks: [],
    pinnedIds: [],
    filter: 'all',
    defaultPriority: 'normal',
    user: null,
  });
  const [activeBoardId, setActiveBoardId] = useState(0);
  const [newBoardTitle, setNewBoardTitle] = useState('');
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const canWriteTask = perms.includes('task.write');
  const canManageBoard = perms.includes('board.manage');

  const refresh = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const data = await backendJSON('/state');
      setState({
        boards: data.boards ?? [],
        tasks: data.tasks ?? [],
        pinnedIds: data.pinned_ids ?? [],
        filter: data.filter || 'all',
        defaultPriority: data.default_priority || 'normal',
        user: data.user ?? null,
      });
      setActiveBoardId((prev) => {
        if (prev && (data.boards ?? []).some((b) => b.id === prev)) return prev;
        return data.boards?.[0]?.id ?? 0;
      });
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    on('init', () => {
      setReady(true);
      setLang(locale());
      setPerms(permissions());
      void refresh();
    });
    on('locale', setLang);
  }, [refresh]);

  const runAction = async (work, okText) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      if (okText) setNotice(okText);
      await refresh();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };

  const addBoard = (event) => {
    event.preventDefault();
    const title = newBoardTitle.trim();
    if (!title || busy) return;
    void runAction(async () => {
      const created = await backendJSON('/boards', { method: 'POST', body: { title } });
      setNewBoardTitle('');
      if (created?.board?.id) setActiveBoardId(created.board.id);
    });
  };

  const addTask = (event) => {
    event.preventDefault();
    const title = newTaskTitle.trim();
    if (!title || !activeBoardId || busy) return;
    void runAction(async () => {
      await backendJSON('/tasks', {
        method: 'POST',
        body: { board_id: activeBoardId, title, priority: newTaskPriority || state.defaultPriority },
      });
      setNewTaskTitle('');
    });
  };

  const toggleTask = (task) => {
    if (!canWriteTask || busy) return;
    void runAction(() =>
      backendJSON(`/tasks/${task.id}`, {
        method: 'PATCH',
        body: { status: task.status === 'done' ? 'open' : 'done' },
      }),
    );
  };

  const togglePin = (taskId, pinned) => {
    if (busy) return;
    void runAction(() => backendJSON(`/me/pins/${taskId}`, { method: pinned ? 'DELETE' : 'POST' }));
  };

  const setFilter = (next) => {
    if (busy) return;
    void runAction(() => backendJSON('/me/filter', { method: 'PUT', body: { filter: next } }));
  };

  const pinnedSet = new Set(state.pinnedIds);
  const activeBoard = state.boards.find((b) => b.id === activeBoardId);
  const visibleTasks = state.tasks.filter((task) => {
    if (activeBoardId && task.board_id !== activeBoardId) return false;
    if (state.filter === 'open') return task.status !== 'done';
    if (state.filter === 'done') return task.status === 'done';
    if (state.filter === 'pinned') return pinnedSet.has(task.id);
    return true;
  });

  const sidebar = h(
    'aside',
    { className: 'tc-sidebar' },
    h(
      Inline,
      { justify: 'between' },
      h(Text, { strong: true }, '共享看板'),
      h(Button, { size: 'sm', icon: 'refresh-cw', disabled: !ready || busy, onClick: () => void refresh() }, '刷新'),
    ),
    state.boards.map((board) =>
      h(
        'button',
        {
          key: board.id,
          type: 'button',
          className: 'tc-board-item',
          'data-active': board.id === activeBoardId ? 'true' : 'false',
          onClick: () => setActiveBoardId(board.id),
        },
        h('span', null, board.title),
        canManageBoard &&
          state.boards.length > 1 &&
          h(
            Button,
            {
              size: 'sm',
              variant: 'ghost',
              disabled: busy,
              onClick: (e) => {
                e.stopPropagation();
                void runAction(() => backendJSON(`/boards/${board.id}`, { method: 'DELETE' }));
              },
            },
            '删除',
          ),
      ),
    ),
    canManageBoard &&
      h(
        'form',
        { onSubmit: addBoard },
        h(
          Stack,
          { gap: 'xs' },
          h(Input, {
            value: newBoardTitle,
            placeholder: '新建看板名称',
            disabled: busy,
            onChange: (e) => setNewBoardTitle(e.currentTarget.value),
          }),
          h(Button, { type: 'submit', size: 'sm', disabled: busy || !newBoardTitle.trim() }, '添加看板'),
        ),
      ),
  );

  const main = h(
    'main',
    { className: 'tc-main' },
    h(
      Inline,
      { justify: 'between' },
      h(
        Inline,
        { gap: 'xs' },
        h(Text, { strong: true }, activeBoard ? activeBoard.title : '待办协作'),
        state.user && h(Tag, { tone: 'neutral' }, state.user.display_name),
      ),
      h(
        Inline,
        { gap: 'xs' },
        [
          ['all', '全部'],
          ['open', '待完成'],
          ['done', '已完成'],
          ['pinned', '我的置顶'],
        ].map(([key, label]) =>
          h(
            Button,
            {
              key,
              size: 'sm',
              variant: state.filter === key ? 'primary' : 'default',
              disabled: busy,
              onClick: () => setFilter(key),
            },
            label,
          ),
        ),
      ),
    ),
    error && h(Notice, { tone: 'error' }, error),
    notice && h(Notice, { tone: 'success' }, notice),
    canWriteTask &&
      activeBoard &&
      h(
        'form',
        { onSubmit: addTask },
        h(
          Inline,
          { gap: 'xs' },
          h(Input, {
            value: newTaskTitle,
            placeholder: '输入共享任务标题…',
            disabled: busy,
            onChange: (e) => setNewTaskTitle(e.currentTarget.value),
          }),
          h(Select, {
            value: newTaskPriority || state.defaultPriority,
            disabled: busy,
            options: [
              { value: 'high', label: '高优先级' },
              { value: 'normal', label: '中优先级' },
              { value: 'low', label: '低优先级' },
            ],
            onChange: (value) => setNewTaskPriority(value),
          }),
          h(Button, { type: 'submit', variant: 'primary', disabled: busy || !newTaskTitle.trim() }, '新增任务'),
        ),
      ),
    visibleTasks.length === 0
      ? h(EmptyState, { compact: true }, ready ? '当前筛选下没有任务' : '请在桌面环境中打开本应用')
      : h(
          Stack,
          { gap: 'xs' },
          visibleTasks.map((task) => {
            const pinned = pinnedSet.has(task.id);
            return h(
              'div',
              { key: task.id, className: 'tc-task-row' },
              h(
                Inline,
                { gap: 'sm' },
                h(Checkbox, {
                  checked: task.status === 'done',
                  disabled: !canWriteTask || busy,
                  onChange: () => toggleTask(task),
                }),
                h(
                  'div',
                  null,
                  h('div', { className: task.status === 'done' ? 'tc-task-done' : '' }, task.title),
                  h('div', { className: 'tc-task-meta' }, `创建者：${task.created_by_name || '成员'}`),
                ),
              ),
              h(
                Inline,
                { gap: 'xs' },
                h(Tag, { tone: priorityTones[task.priority] ?? 'neutral' }, priorityLabels[task.priority] ?? task.priority),
                h(
                  Button,
                  { size: 'sm', variant: pinned ? 'primary' : 'default', disabled: busy, onClick: () => togglePin(task.id, pinned) },
                  pinned ? '已置顶' : '置顶',
                ),
                h(
                  Button,
                  {
                    size: 'sm',
                    disabled: busy,
                    onClick: () =>
                      void runAction(() => backendJSON(`/remind/${task.id}`, { method: 'POST' }), '已发送站内提醒'),
                  },
                  '提醒我',
                ),
                canWriteTask &&
                  h(
                    Button,
                    {
                      size: 'sm',
                      variant: 'danger',
                      disabled: busy,
                      onClick: () => void runAction(() => backendJSON(`/tasks/${task.id}`, { method: 'DELETE' })),
                    },
                    '删除',
                  ),
              ),
            );
          }),
        ),
  );

  return h(ConfigProvider, { locale: lang }, h(Workspace, { className: 'tc-app' }, sidebar, main));
}

createRoot(document.getElementById('root')).render(h(App));

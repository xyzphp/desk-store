import { useMemo, useState } from 'react';
import { AppCardGrid, SearchField, SegmentedControl } from '@xyzos/desk-ui';
import { categoryLabels, fetchIndex } from '../api';
import { StoreAppCard } from '../components/StoreAppCard';
import { navigate } from '../router';
import { useData } from '../useData';

export function AppList({ category = 'all' }: { category?: string }) {
  const index = useData(fetchIndex, 'index');
  const [query, setQuery] = useState('');
  const apps = index.status === 'ready' ? index.data.apps : [];
  const categories = useMemo(() => [...new Set(apps.map((app) => app.category))].sort(), [apps]);
  const options = [{ value: 'all', label: '全部' }, ...categories.map((value) => ({ value, label: categoryLabels[value] ?? value }))];
  const current = options.some((option) => option.value === category) ? category : 'all';
  const keyword = query.trim().toLowerCase();
  const visible = apps.filter((app) => {
    if (current !== 'all' && app.category !== current) return false;
    if (!keyword) return true;
    return [app.name, app.slug, app.summary, ...app.tags].some((text) => text.toLowerCase().includes(keyword));
  });
  return (
    <section className="store-section store-section--first">
      <div className="store-list-head">
        <div>
          <h1>应用</h1>
          <p className="store-muted">共 {apps.filter((app) => !app.withdrawn).length} 个应用，全部开源，以源码提交并经评审。</p>
        </div>
        <SearchField
          className="store-search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="搜索名称、简介或标签"
        />
      </div>
      {options.length > 2 && (
        <SegmentedControl
          aria-label="应用分类"
          options={options}
          value={current}
          onChange={(value) => navigate({ name: 'apps', category: value === 'all' ? undefined : value })}
        />
      )}
      {index.status === 'loading' && <p className="store-muted">正在读取应用列表…</p>}
      {index.status === 'error' && <p className="store-muted">应用列表读取失败：{index.message}</p>}
      {index.status === 'ready' && visible.length === 0 && <p className="store-muted">没有符合条件的应用。</p>}
      <AppCardGrid aria-label="应用列表" className="store-card-list">
        {visible.map((app) => (
          <StoreAppCard key={app.slug} app={app} headingLevel={2} />
        ))}
      </AppCardGrid>
    </section>
  );
}

import { useMemo, useState } from 'react';
import { AppCardGrid, Button, Icon, SearchField, Select } from '@xyzos/desk-ui';
import {
  appType,
  appTypeLabels,
  categoryLabels,
  fetchIndex,
  type AppType,
} from '../api';
import { StoreAppCard } from '../components/StoreAppCard';
import { navigate } from '../router';
import { useData } from '../useData';

type ViewMode = 'grid' | 'list';

export function AppList({ category = 'all' }: { category?: string }) {
  const index = useData(fetchIndex, 'index');
  const [query, setQuery] = useState('');
  const [type, setType] = useState<AppType | 'all'>('all');
  const [layout, setLayout] = useState<ViewMode>('grid');

  const apps = index.status === 'ready' ? index.data.apps : [];
  const activeCount = apps.filter((app) => !app.withdrawn).length;

  const categories = useMemo(
    () => [...new Set(apps.map((app) => app.category))].sort(),
    [apps],
  );
  const categoryOptions = [
    { value: 'all', label: '全部' },
    ...categories.map((value) => ({
      value,
      label: categoryLabels[value] ?? value,
    })),
  ];
  const currentCategory = categoryOptions.some((option) => option.value === category)
    ? category
    : 'all';

  const types = useMemo(
    () => [...new Set(apps.map((app) => appType(app.components)))],
    [apps],
  );
  const typeOptions = [
    { value: 'all', label: '全部类型' },
    ...(['app', 'mixed', 'mcp', 'skills'] as const)
      .filter((value) => types.includes(value))
      .map((value) => ({ value, label: appTypeLabels[value] })),
  ];

  const keyword = query.trim().toLowerCase();
  const visible = apps.filter((app) => {
    if (currentCategory !== 'all' && app.category !== currentCategory) return false;
    if (type !== 'all' && appType(app.components) !== type) return false;
    if (!keyword) return true;
    return [app.name, app.slug, app.summary, ...app.tags].some((text) =>
      text.toLowerCase().includes(keyword),
    );
  });

  const hasFilter = currentCategory !== 'all' || type !== 'all' || keyword.length > 0;
  const resetFilters = () => {
    setQuery('');
    setType('all');
    if (currentCategory !== 'all') {
      navigate({ name: 'apps' });
    }
  };

  return (
    <section className="store-section store-section--first">
      <div className="store-page-title">
        <div>
          <p className="store-eyebrow">Explore apps</p>
          <h1>应用商店</h1>
          <p className="store-muted">
            共 {activeCount} 个开源应用，以源码提交并经审核签名发布。
          </p>
        </div>
        <div className="store-page-title-actions">
          <Button
            variant="quiet"
            icon="book-open"
            onClick={() => navigate({ name: 'docs', section: 'platform', page: 'capabilities' })}
          >
            平台能力
          </Button>
          <Button
            icon="plus"
            onClick={() => navigate({ name: 'docs', section: 'site', page: 'submit' })}
          >
            提交应用
          </Button>
        </div>
      </div>

      <div className="store-toolbar" role="search" aria-label="筛选应用">
        <SearchField
          className="store-search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="搜索名称、简介或标签"
          aria-label="搜索应用"
        />

        {categoryOptions.length > 2 && (
          <div className="store-filter-pills" role="group" aria-label="应用分类">
            {categoryOptions.map((option) => {
              const active = option.value === currentCategory;
              return (
                <button
                  key={option.value}
                  type="button"
                  className={active ? 'is-active' : undefined}
                  aria-pressed={active}
                  onClick={() =>
                    navigate({
                      name: 'apps',
                      category: option.value === 'all' ? undefined : option.value,
                    })
                  }
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        )}

        {typeOptions.length > 2 && (
          <Select
            className="store-type-select"
            aria-label="应用类型"
            value={type}
            onChange={(event) => setType(event.currentTarget.value as AppType | 'all')}
          >
            {typeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        )}

        <div className="store-view-toggle" role="group" aria-label="切换展示方式">
          <button
            type="button"
            className={layout === 'grid' ? 'is-active' : undefined}
            aria-pressed={layout === 'grid'}
            onClick={() => setLayout('grid')}
          >
            <Icon name="layout-grid" size={14} />
            <span>卡片</span>
          </button>
          <button
            type="button"
            className={layout === 'list' ? 'is-active' : undefined}
            aria-pressed={layout === 'list'}
            onClick={() => setLayout('list')}
          >
            <Icon name="list" size={14} />
            <span>列表</span>
          </button>
        </div>
      </div>

      {index.status === 'ready' && (
        <div className="store-resultbar">
          <span>
            显示 {visible.length} / {apps.length} 个应用
          </span>
          {hasFilter && (
            <button type="button" className="store-reset-btn" onClick={resetFilters}>
              重置筛选
            </button>
          )}
        </div>
      )}

      {index.status === 'loading' && <p className="store-muted">正在读取应用列表…</p>}
      {index.status === 'error' && <p className="store-muted">应用列表读取失败：{index.message}</p>}

      {index.status === 'ready' && visible.length === 0 ? (
        <div className="store-empty">
          <p>未找到匹配的应用，请调整关键词或筛选条件。</p>
          {hasFilter && (
            <Button size="sm" onClick={resetFilters}>
              清空筛选条件
            </Button>
          )}
        </div>
      ) : (
        <AppCardGrid
          aria-label="应用列表"
          className={layout === 'list' ? 'store-card-grid store-card-grid--list' : 'store-card-grid'}
        >
          {visible.map((app) => (
            <StoreAppCard key={app.slug} app={app} headingLevel={2} layout={layout} />
          ))}
        </AppCardGrid>
      )}
    </section>
  );
}

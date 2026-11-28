import { AppCard, Tag } from '@xyzos/desk-ui';
import {
  appType,
  appTypeLabels,
  categoryLabels,
  pricingLabels,
  resolveAsset,
  type IndexEntry,
} from '../api';
import { href } from '../router';

/** 商店索引条目对应的应用卡片：支持卡片视图与紧凑列表视图，整卡点击直达独立详情页。 */
export function StoreAppCard({
  app,
  headingLevel,
  layout = 'grid',
}: {
  app: IndexEntry;
  headingLevel?: 2 | 3;
  layout?: 'grid' | 'list';
}) {
  const type = appType(app.components);
  return (
    <AppCard
      className={layout === 'list' ? 'store-app-card store-app-card--list' : 'store-app-card'}
      tintSeed={app.slug}
      name={app.name}
      summary={app.summary}
      icon={{ image: resolveAsset(app.icon) }}
      href={href({ name: 'app', slug: app.slug })}
      headingLevel={headingLevel}
      meta={layout === 'list' ? `v${app.latestVersion}` : undefined}
      tags={
        <>
          <Tag shape="pill" color="blue">
            {categoryLabels[app.category] ?? app.category}
          </Tag>
          {type !== 'app' && (
            <Tag shape="pill" color="purple">
              {appTypeLabels[type]}
            </Tag>
          )}
          {app.withdrawn ? (
            <Tag shape="pill" dot tone="muted">
              已下架
            </Tag>
          ) : (
            app.pricing !== 'free' && (
              <Tag shape="pill" tone="warning">
                {pricingLabels[app.pricing] ?? app.pricing}
              </Tag>
            )
          )}
        </>
      }
    />
  );
}

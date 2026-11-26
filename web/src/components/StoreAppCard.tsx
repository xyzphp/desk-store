import { AppCard, Tag } from '@xyzos/desk-ui';
import { categoryLabels, pricingLabels, resolveAsset, type IndexEntry } from '../api';
import { href } from '../router';

/** 商店索引条目对应的应用卡片；整卡链接到详情页。 */
export function StoreAppCard({ app, headingLevel }: { app: IndexEntry; headingLevel?: 2 | 3 }) {
  return (
    <AppCard
      name={app.name}
      summary={app.summary}
      icon={{ image: resolveAsset(app.icon) }}
      href={href({ name: 'app', slug: app.slug })}
      headingLevel={headingLevel}
      tags={
        <>
          <Tag color="blue">{categoryLabels[app.category] ?? app.category}</Tag>
          {app.pricing !== 'free' && <Tag tone="warning">{pricingLabels[app.pricing]}</Tag>}
          {app.withdrawn && <Tag tone="muted">已下架</Tag>}
        </>
      }
      meta={`v${app.latestVersion}`}
    />
  );
}

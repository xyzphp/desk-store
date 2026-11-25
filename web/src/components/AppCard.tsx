import { Tag } from '@xyzos/desk-ui';
import { categoryLabels, pricingLabels, resolveAsset, type IndexEntry } from '../api';
import { href } from '../router';

export function AppIconImage({ src, name, size = 'md' }: { src: string; name: string; size?: 'md' | 'lg' }) {
  return (
    <span className={`store-app-icon store-app-icon--${size}`} aria-hidden="true">
      {src ? <img src={resolveAsset(src)} alt="" /> : <span>{name.slice(0, 1)}</span>}
    </span>
  );
}

export function AppCard({ app }: { app: IndexEntry }) {
  return (
    <a className="store-card" href={href({ name: 'app', slug: app.slug })}>
      <AppIconImage src={app.icon} name={app.name} />
      <span className="store-card-body">
        <span className="store-card-title">
          {app.name}
          {app.withdrawn && <Tag tone="muted">已下架</Tag>}
        </span>
        <span className="store-card-summary">{app.summary}</span>
        <span className="store-card-meta">
          <Tag color="blue">{categoryLabels[app.category] ?? app.category}</Tag>
          {app.pricing !== 'free' && <Tag tone="warning">{pricingLabels[app.pricing]}</Tag>}
          <span>v{app.latestVersion}</span>
        </span>
      </span>
    </a>
  );
}

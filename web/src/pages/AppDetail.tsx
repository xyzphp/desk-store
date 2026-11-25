import { Button, CodeBlock, MarkdownView, Notice, Tag } from '@xyzos/desk-ui';
import {
  capabilityLabels,
  categoryLabels,
  fetchApp,
  formatBytes,
  formatDate,
  pricingLabels,
  resolveAsset,
  storeAddress,
  type AppVersion,
  type PermissionSummary,
} from '../api';
import { AppIconImage } from '../components/AppCard';
import { href } from '../router';
import { useData } from '../useData';

function Permissions({ summary }: { summary: PermissionSummary }) {
  return (
    <ul className="store-permissions">
      <li>{summary.entry === 'gateway_page' ? '页面来自经网关代理的上游服务' : '页面为包内静态文件'}</li>
      <li>
        {summary.gatewayApi.length === 0 ? (
          '不调用系统接口'
        ) : (
          <>
            以当前用户身份调用系统接口：
            {summary.gatewayApi.map((scope) => (
              <code key={scope}>{scope}</code>
            ))}
          </>
        )}
      </li>
      {summary.proxies.length === 0 && <li>不访问外部服务</li>}
      {summary.proxies.map((proxy) => (
        <li key={proxy.key}>
          访问 <strong>{proxy.title}</strong>：<code>{proxy.upstream}</code>
          {proxy.baseUrlEditable && '（安装时可修改地址）'}，方法 {proxy.methods.join(' / ')}，路径{' '}
          {proxy.paths.map((path) => (
            <code key={path}>{path}</code>
          ))}
          {proxy.needsCredential ? `，需要管理员填写凭据（${proxy.authType}）` : '，无需凭据'}
        </li>
      ))}
      {summary.desktopWidget && <li>提供桌面卡片</li>}
    </ul>
  );
}

function VersionRow({ version, latest }: { version: AppVersion; latest: boolean }) {
  return (
    <li className="store-version">
      <div className="store-version-head">
        <strong>v{version.version}</strong>
        {latest && <Tag tone="success">最新</Tag>}
        {version.yanked && <Tag tone="danger">已撤回</Tag>}
        <span className="store-muted">
          {formatDate(version.publishedAt)} · {formatBytes(version.size)}
        </span>
      </div>
      {version.changelog && <MarkdownView className="store-markdown store-markdown--compact" value={version.changelog} />}
      <code className="store-hash" title="安装包 SHA-256">
        sha256 {version.sha256}
      </code>
    </li>
  );
}

export function AppDetailPage({ slug }: { slug: string }) {
  const state = useData(() => fetchApp(slug), slug);
  if (state.status === 'loading') return <p className="store-section store-muted">正在读取应用…</p>;
  if (state.status === 'error') {
    return (
      <section className="store-section store-section--first">
        <h1>没有找到这个应用</h1>
        <p className="store-muted">读取 {slug} 失败：{state.message}</p>
        <a href={href({ name: 'apps' })}>返回应用列表</a>
      </section>
    );
  }
  const app = state.data;
  const latest = app.versions.find((version) => version.version === app.latestVersion) ?? app.versions[0];
  return (
    <article className="store-section store-section--first store-detail">
      <a className="store-back" href={href({ name: 'apps' })}>
        ← 全部应用
      </a>
      <header className="store-detail-head">
        <AppIconImage src={app.icon} name={app.name} size="lg" />
        <div className="store-detail-title">
          <h1>{app.name}</h1>
          <p>{app.summary}</p>
          <div className="store-card-meta">
            <a href={href({ name: 'apps', category: app.category })}>
              <Tag color="blue">{categoryLabels[app.category] ?? app.category}</Tag>
            </a>
            <Tag tone={app.pricing === 'free' ? 'success' : 'warning'}>{pricingLabels[app.pricing]}</Tag>
            {app.tags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </div>
        </div>
        {latest && !app.withdrawn && (
          <Button variant="primary" icon="download" onClick={() => window.open(resolveAsset(latest.url), '_blank', 'noopener')}>
            下载 v{latest.version}
          </Button>
        )}
      </header>

      {app.withdrawn && <Notice tone="warning">这个应用已下架，不再提供新安装。已安装的系统会显示提示，可以继续使用或卸载。</Notice>}
      {app.pricing !== 'free' && app.pricingUrl && (
        <Notice tone="info">
          应用本身免费开源，但使用时需要订阅作者提供的外部服务。
          <a href={app.pricingUrl} target="_blank" rel="noopener noreferrer">
            查看服务与价格
          </a>
        </Notice>
      )}

      <div className="store-detail-grid">
        <div className="store-detail-main">
          <section>
            <h2>介绍</h2>
            <MarkdownView className="store-markdown" value={app.description || app.summary} />
          </section>
          {app.screenshots.length > 0 && (
            <section>
              <h2>截图</h2>
              <div className="store-screenshots">
                {app.screenshots.map((shot, index) => (
                  <img key={shot} src={resolveAsset(shot)} alt={`${app.name} 截图 ${index + 1}`} loading="lazy" />
                ))}
              </div>
            </section>
          )}
          <section>
            <h2>版本</h2>
            <ul className="store-versions">
              {app.versions.map((version) => (
                <VersionRow key={version.version} version={version} latest={version.version === app.latestVersion} />
              ))}
            </ul>
          </section>
        </div>

        <aside className="store-detail-side">
          <section className="store-panel">
            <h2>安装到系统</h2>
            <ol className="store-install-steps">
              <li>在「应用管理 → 应用商店 → 商店源」添加商店地址：</li>
            </ol>
            <CodeBlock code={storeAddress()} label="商店地址" />
            <ol className="store-install-steps" start={2}>
              <li>在「应用商店」中找到「{app.name}」，点击安装。</li>
              <li>确认权限，按提示填写服务地址与凭据。</li>
              <li>在账号或角色管理中把应用授权给需要的人。</li>
            </ol>
          </section>
          {latest && (
            <section className="store-panel">
              <h2>权限与访问</h2>
              <Permissions summary={latest.permissions} />
              {latest.permissions.capabilities.length > 0 && (
                <div className="store-card-meta">
                  {latest.permissions.capabilities.map((capability) => (
                    <Tag key={capability} tone="muted">
                      {capabilityLabels[capability] ?? capability}
                    </Tag>
                  ))}
                </div>
              )}
            </section>
          )}
          <section className="store-panel">
            <h2>信息</h2>
            <dl className="store-facts">
              <dt>标识</dt>
              <dd>
                <code>{app.slug}</code>
              </dd>
              <dt>作者</dt>
              <dd>
                {app.authors.map((author, index) => (
                  <span key={author.name}>
                    {index > 0 && '、'}
                    {author.url ? (
                      <a href={author.url} target="_blank" rel="noopener noreferrer">
                        {author.name}
                      </a>
                    ) : (
                      author.name
                    )}
                  </span>
                ))}
              </dd>
              <dt>许可证</dt>
              <dd>{app.license}</dd>
              {app.source && (
                <>
                  <dt>源码</dt>
                  <dd>
                    <a href={app.source} target="_blank" rel="noopener noreferrer">
                      在商店仓库中查看
                    </a>
                  </dd>
                </>
              )}
              {app.homepage && (
                <>
                  <dt>主页</dt>
                  <dd>
                    <a href={app.homepage} target="_blank" rel="noopener noreferrer">
                      {new URL(app.homepage).host}
                    </a>
                  </dd>
                </>
              )}
            </dl>
          </section>
        </aside>
      </div>
    </article>
  );
}

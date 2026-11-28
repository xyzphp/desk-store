import {
  AppIcon,
  Button,
  CodeBlock,
  DetailLayout,
  ImageGallery,
  Inline,
  MarkdownView,
  Notice,
  Panel,
  Property,
  PropertySheet,
  Stack,
  Tabs,
  Tag,
  Text,
  Timeline,
  type TabItem,
} from '@xyzos/desk-ui';
import {
  appType,
  appTypeLabels,
  categoryLabels,
  fetchAdvisories,
  fetchApp,
  formatBytes,
  formatDate,
  pricingLabels,
  resolveAsset,
  severityLabels,
  storeAddress,
  type AppDetail,
} from '../api';
import { useStoreToast } from '../components/ToastContext';
import { href } from '../router';
import { useData } from '../useData';
import {
  ApiIntegrationTab,
  CapabilitySummaryPanel,
  hasApiIntegration,
  hasMcpComponents,
  hasSkillComponents,
  McpTab,
  PermissionsSecurityTab,
} from './AppDetailSections';
import { SkillDetailTab } from './SkillDetailView';

function safeHost(value: string): string {
  try {
    return new URL(value).host || value;
  } catch {
    return value;
  }
}

function migrationCount(version: AppDetail['versions'][number]) {
  return Object.values(version.migrations ?? {}).reduce((total, list) => total + list.length, 0);
}

function versionItems(app: AppDetail) {
  return app.versions.map((version) => ({
    id: version.version,
    title: `v${version.version}`,
    time: `${formatDate(version.publishedAt)} · ${formatBytes(version.size)}`,
    dateTime: version.publishedAt,
    content: (
      <Stack gap="xs">
        {(version.version === app.latestVersion || version.yanked) && (
          <Inline gap="xs">
            {version.version === app.latestVersion && <Tag tone="success">最新</Tag>}
            {version.yanked && <Tag tone="danger">已撤回</Tag>}
          </Inline>
        )}
        {version.changelog && <MarkdownView className="store-markdown" value={version.changelog} />}
        {migrationCount(version) > 0 && (
          <Text tone="muted" size="sm">
            包含 {migrationCount(version)} 个数据库迁移文件，更新时由系统按顺序执行
          </Text>
        )}
        <Text tone="muted" size="sm" code title="安装包 SHA-256">
          sha256 {version.sha256}
        </Text>
      </Stack>
    ),
  }));
}

function Facts({ app }: { app: AppDetail }) {
  return (
    <PropertySheet density="compact">
      <Property label="标识">
        <Text code>{app.slug}</Text>
      </Property>
      <Property label="作者">
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
      </Property>
      <Property label="许可证">{app.license}</Property>
      {app.source && (
        <Property label="源码">
          <a href={app.source} target="_blank" rel="noopener noreferrer">
            在商店仓库中查看
          </a>
        </Property>
      )}
      {app.homepage && (
        <Property label="主页">
          <a href={app.homepage} target="_blank" rel="noopener noreferrer">
            {safeHost(app.homepage)}
          </a>
        </Property>
      )}
    </PropertySheet>
  );
}

export function AppDetailPage({ slug }: { slug: string }) {
  const state = useData(() => fetchApp(slug), slug);
  const advisoryState = useData(fetchAdvisories, 'advisories');
  const { copyText } = useStoreToast();

  if (state.status === 'loading') return <p className="store-section store-muted">正在读取应用…</p>;
  if (state.status === 'error') {
    return (
      <section className="store-section store-section--first">
        <h1>没有找到这个应用</h1>
        <p className="store-muted">
          读取 {slug} 失败：{state.message}
        </p>
        <a href={href({ name: 'apps' })}>返回应用列表</a>
      </section>
    );
  }
  const app = state.data;
  const latest = app.versions.find((version) => version.version === app.latestVersion) ?? app.versions[0];
  const type = appType(latest?.components);
  const advisories =
    advisoryState.status === 'ready' ? advisoryState.data.filter((item) => item.slug === app.slug) : [];
  const showApiTab = hasApiIntegration(latest?.permissions);
  const showMcpTab = hasMcpComponents(latest?.permissions);
  const showSkillsTab = hasSkillComponents(latest?.permissions);

  const tabs: TabItem[] = [
    {
      value: 'overview',
      label: '应用介绍',
      content: (
        <Stack gap="md">
          <Panel>
            <MarkdownView className="store-markdown" value={app.description || app.summary} />
          </Panel>
          {app.screenshots.length > 0 && (
            <Panel title="截图">
              <ImageGallery
                label={`${app.name} 截图`}
                items={app.screenshots.map((shot, index) => ({
                  src: resolveAsset(shot),
                  alt: `${app.name} 截图 ${index + 1}`,
                }))}
              />
            </Panel>
          )}
        </Stack>
      ),
    },
  ];
  if (showApiTab && latest) {
    tabs.push({
      value: 'api',
      label: '接口与集成',
      content: <ApiIntegrationTab key={`${app.slug}:${latest.version}`} summary={latest.permissions} />,
    });
  }
  if (showMcpTab && latest) {
    tabs.push({
      value: 'mcp',
      label: 'MCP',
      content: <McpTab slug={app.slug} summary={latest.permissions} />,
    });
  }
  if (showSkillsTab && latest) {
    tabs.push({
      value: 'skills',
      label: '技能',
      content: (
        <SkillDetailTab
          key={`${app.slug}:${latest.version}`}
          slug={app.slug}
          skills={latest.permissions.skills ?? []}
          source={app.source}
        />
      ),
    });
  }
  if (latest) {
    tabs.push({
      value: 'permissions',
      label: '权限与安全',
      content: <PermissionsSecurityTab summary={latest.permissions} />,
    });
  }
  tabs.push({
    value: 'versions',
    label: '版本记录',
    content: (
      <Panel>
        <Timeline label="版本记录" items={versionItems(app)} />
      </Panel>
    ),
  });

  return (
    <div className="store-section store-section--first store-detail-page">
      <nav className="store-detail-nav" aria-label="面包屑导航">
        <a href={href({ name: 'home' })}>首页</a>
        <span className="store-detail-nav-sep" aria-hidden="true">
          /
        </span>
        <a href={href({ name: 'apps' })}>应用</a>
        <span className="store-detail-nav-sep" aria-hidden="true">
          /
        </span>
        <a href={href({ name: 'apps', category: app.category })}>{categoryLabels[app.category] ?? app.category}</a>
        <span className="store-detail-nav-sep" aria-hidden="true">
          /
        </span>
        <span className="store-detail-nav-current">{app.name}</span>
      </nav>
      <DetailLayout
        headingLevel={1}
        media={<AppIcon image={resolveAsset(app.icon) || undefined} glyph={app.name.slice(0, 1)} size={80} />}
        title={app.name}
        description={app.summary}
        meta={
          <>
            <a href={href({ name: 'apps', category: app.category })}>
              <Tag color="blue">{categoryLabels[app.category] ?? app.category}</Tag>
            </a>
            {type !== 'app' && <Tag color="purple">{appTypeLabels[type]}</Tag>}
            <Tag tone={app.pricing === 'free' ? 'success' : 'warning'}>{pricingLabels[app.pricing]}</Tag>
            {app.tags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </>
        }
        actions={
          latest &&
          !app.withdrawn && (
            <Button
              variant="primary"
              icon="download"
              onClick={() => window.open(resolveAsset(latest.url), '_blank', 'noopener')}
            >
              下载 v{latest.version}
            </Button>
          )
        }
        aside={
          <>
            <Panel title="安装到系统">
              <ol className="store-install-steps">
                <li>在「应用管理 → 应用商店 → 商店源」添加商店地址：</li>
              </ol>
              <CodeBlock
                code={storeAddress()}
                label="商店地址"
                onCopy={(text) => copyText(text, '商店地址已复制')}
              />
              <ol className="store-install-steps" start={2}>
                <li>在「应用商店」中找到「{app.name}」，点击安装。</li>
                <li>确认权限，按提示填写服务地址与凭据。</li>
                <li>在账号或角色管理中把应用授权给需要的人。</li>
              </ol>
              <p className="store-install-guide-link">
                <a href={href({ name: 'docs', section: 'site', page: 'permissions-and-security' })}>
                  了解权限与安全说明 →
                </a>
              </p>
            </Panel>
            {latest && <CapabilitySummaryPanel version={latest} />}
            <Panel title="信息">
              <Facts app={app} />
            </Panel>
          </>
        }
      >
        {advisories.map((advisory) => (
          <Notice key={advisory.id} tone={advisory.severity === 'low' ? 'info' : 'warning'}>
            <strong>
              安全通告 {advisory.id}（{severityLabels[advisory.severity]}）：{advisory.title}
            </strong>
            <br />
            受影响版本 <code>{advisory.versions}</code>
            {advisory.action === 'update' && advisory.fixedIn
              ? `，请更新到 v${advisory.fixedIn} 或更高版本。`
              : '，暂无修复版本，建议停用。'}
          </Notice>
        ))}
        {app.withdrawn && (
          <Notice tone="warning">这个应用已下架，不再提供新安装。已安装的系统会显示提示，可以继续使用或卸载。</Notice>
        )}
        {app.pricing !== 'free' && app.pricingUrl && (
          <Notice tone="info">
            应用本身免费开源，但使用时需要订阅作者提供的外部服务。
            <a href={app.pricingUrl} target="_blank" rel="noopener noreferrer">
              查看服务与价格
            </a>
          </Notice>
        )}
        <Tabs key={app.slug} aria-label="应用详情分区" items={tabs} />
      </DetailLayout>
    </div>
  );
}

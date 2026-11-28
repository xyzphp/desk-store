import { AppCardGrid, Button, Icon, type IconName } from '@xyzos/desk-ui';
import { fetchIndex, storeAddress } from '../api';
import { StoreHeroArt } from '../components/BrandLogo';
import { StoreAppCard } from '../components/StoreAppCard';
import { useStoreToast } from '../components/ToastContext';
import { href, navigate } from '../router';
import { useData } from '../useData';

const features: { icon: IconName; title: string; text: string }[] = [
  {
    icon: 'code-xml',
    title: '源码即应用',
    text: '每个应用都是仓库里的独立目录，通过 PR 提交并评审源码与版本差异。',
  },
  {
    icon: 'shield-check',
    title: '签名发布',
    text: '合并后由 CI 确定性打包并用商店密钥签名，系统安装前校验签名与哈希。',
  },
  {
    icon: 'boxes',
    title: '沙箱运行',
    text: '运行在不透明源沙箱中，接口与数据只能经清单声明的受控通道访问。',
  },
  {
    icon: 'globe',
    title: '可以自建',
    text: '纯静态站点，Fork 仓库并配置签名密钥，即可为团队搭建专属商店。',
  },
];

const miniSteps = ['编写应用', '本地校验', '提交 PR', '合并发布'];

export function Home() {
  const index = useData(fetchIndex, 'index');
  const { copyText } = useStoreToast();
  const address = storeAddress();
  const apps =
    index.status === 'ready'
      ? index.data.apps.filter((app) => !app.withdrawn).slice(0, 6)
      : [];

  return (
    <>
      <section className="store-hero">
        <div className="store-hero-copy">
          <span className="store-pill">开源应用商店</span>
          <h1>
            为浏览器桌面，
            <br />
            发现更好的应用。
          </h1>
          <p className="store-hero-lead">
            Desk Store 收录以源码形式提交的开源应用。在系统中添加商店源，即可搜索、安装与一键更新；开发者按文档编写应用并提交
            Pull Request 即可上架。
          </p>
          <div className="store-hero-actions">
            <Button variant="primary" icon="layout-grid" onClick={() => navigate({ name: 'apps' })}>
              浏览应用
            </Button>
            <Button icon="book-open" onClick={() => navigate({ name: 'docs', section: 'develop', page: 'quick-start' })}>
              开发应用
            </Button>
          </div>
        </div>
        <StoreHeroArt />
      </section>

      <section className="store-section" aria-label="核心特性">
        <div className="store-features">
          {features.map((feature) => (
            <article key={feature.title} className="store-feature">
              <div className="store-feature-icon" aria-hidden="true">
                <Icon name={feature.icon} size={18} />
              </div>
              <div className="store-feature-body">
                <h2>{feature.title}</h2>
                <p>{feature.text}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="store-section">
        <div className="store-section-head">
          <div>
            <h2>最新应用</h2>
            <p className="store-muted store-small">从开源社区发现效率、监控与开发工具</p>
          </div>
          <a className="store-inline-link" href={href({ name: 'apps' })}>
            <span>查看全部应用</span>
            <Icon name="chevron-right" size={15} />
          </a>
        </div>
        {index.status === 'loading' && <p className="store-muted">正在读取应用列表…</p>}
        {index.status === 'error' && <p className="store-muted">应用列表读取失败：{index.message}</p>}
        {index.status === 'ready' && apps.length === 0 && <p className="store-muted">还没有上架的应用。</p>}
        {apps.length > 0 && (
          <AppCardGrid aria-label="最新应用" className="store-card-grid">
            {apps.map((app) => (
              <StoreAppCard key={app.slug} app={app} headingLevel={3} />
            ))}
          </AppCardGrid>
        )}
      </section>

      <section className="store-section store-guides" aria-label="快速上手引导">
        <div className="store-panel">
          <h2>在系统中使用</h2>
          <p className="store-muted">
            管理员打开「应用管理 → 应用商店 → 商店源」，添加下方商店地址并核对签名公钥指纹，即可直接浏览、安装和更新应用。
          </p>
          <div className="store-address-bar">
            <code>{address}</code>
            <button
              type="button"
              className="store-copy-link"
              onClick={() => void copyText(address, '商店地址已复制')}
            >
              <Icon name="copy" size={14} />
              <span>复制地址</span>
            </button>
          </div>
          <div className="store-panel-foot">
            <a className="store-inline-link" href={href({ name: 'docs', section: 'site', page: 'install-in-xyzos' })}>
              <span>查看完整安装步骤</span>
              <Icon name="chevron-right" size={15} />
            </a>
            <a className="store-inline-link" href={href({ name: 'docs', section: 'platform', page: 'capabilities' })}>
              <span>了解平台能力</span>
              <Icon name="chevron-right" size={15} />
            </a>
          </div>
        </div>

        <div className="store-panel">
          <h2>提交一个应用</h2>
          <p className="store-muted">
            支持零构建纯静态应用（格式 1）与带 Go Wasm 后端、AI 工具和技能的全栈应用（格式 2），本地校验通过后即可提交 PR。
          </p>
          <ol className="store-steps-mini">
            {miniSteps.map((step, idx) => (
              <li key={step}>
                <span className="store-step-num">{idx + 1}</span>
                <span>{step}</span>
                {idx < miniSteps.length - 1 && (
                  <span className="store-step-arrow" aria-hidden="true">
                    →
                  </span>
                )}
              </li>
            ))}
          </ol>
          <div className="store-panel-foot">
            <a className="store-inline-link" href={href({ name: 'docs', section: 'develop', page: 'quick-start' })}>
              <span>阅读开发指南</span>
              <Icon name="chevron-right" size={15} />
            </a>
            <a className="store-inline-link" href={href({ name: 'docs', section: 'site', page: 'submit' })}>
              <span>查看评审规范</span>
              <Icon name="chevron-right" size={15} />
            </a>
          </div>
        </div>
      </section>
    </>
  );
}

package appspec

// 商店对外发布的静态数据格式（数据格式版本 1）。所有文件位于 `{商店地址}/api/v1/` 下，
// 文件中的相对地址都相对于这个目录解析。

// CatalogSchema 是静态数据格式版本；不兼容的变化必须使用新的目录（如 /api/v2/）。
const CatalogSchema = 1

// StoreInfo 是 api/v1/store.json：商店身份、访问方式与签名公钥。
type StoreInfo struct {
	Schema      int         `json:"schema"`
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Description string      `json:"description"`
	Homepage    string      `json:"homepage,omitempty"`
	Access      string      `json:"access"` // public 匿名访问；token 需要访问令牌
	Formats     []int       `json:"formats"`
	Keys        []PublicKey `json:"keys"`
}

// Index 是 api/v1/index.json：全部应用的摘要。
type Index struct {
	Schema      int          `json:"schema"`
	GeneratedAt string       `json:"generatedAt"`
	Apps        []IndexEntry `json:"apps"`
}

// IndexEntry 是列表中的一个应用。
type IndexEntry struct {
	Slug          string   `json:"slug"`
	Name          string   `json:"name"`
	Summary       string   `json:"summary"`
	Category      string   `json:"category"`
	Tags          []string `json:"tags"`
	Icon          string   `json:"icon"`
	LatestVersion string   `json:"latestVersion"`
	Pricing       string   `json:"pricing"`
	Capabilities  []string `json:"capabilities"`
	Withdrawn     bool     `json:"withdrawn"`
	UpdatedAt     string   `json:"updatedAt"`
}

// AppDetail 是 api/v1/apps/{slug}.json。
type AppDetail struct {
	Schema        int       `json:"schema"`
	Slug          string    `json:"slug"`
	Name          string    `json:"name"`
	Summary       string    `json:"summary"`
	Description   string    `json:"description"` // Markdown
	Category      string    `json:"category"`
	Tags          []string  `json:"tags"`
	Authors       []Author  `json:"authors"`
	License       string    `json:"license"`
	Homepage      string    `json:"homepage,omitempty"`
	Repository    string    `json:"repository,omitempty"`
	Source        string    `json:"source,omitempty"` // 商店仓库中的应用目录
	Pricing       string    `json:"pricing"`
	PricingURL    string    `json:"pricingUrl,omitempty"`
	Icon          string    `json:"icon"`
	Screenshots   []string  `json:"screenshots"`
	Withdrawn     bool      `json:"withdrawn"`
	LatestVersion string    `json:"latestVersion"`
	Versions      []Version `json:"versions"`
}

// Version 是一个已发布版本；发布后除 yanked 外不再改变。
type Version struct {
	Version     string     `json:"version"`
	Format      int        `json:"format"`
	SHA256      string     `json:"sha256"`
	Size        int        `json:"size"`
	URL         string     `json:"url"`
	PublishedAt string     `json:"publishedAt"`
	Yanked      bool       `json:"yanked"`
	Changelog   string     `json:"changelog,omitempty"`
	Permissions Summary    `json:"permissions"`
	Signature   *Signature `json:"signature,omitempty"`
}

// Record 返回该版本的签名记录。
func (v Version) Record(store, slug string) SignedRecord {
	return SignedRecord{Store: store, Slug: slug, Version: v.Version, SHA256: v.SHA256, Format: v.Format}
}

package appspec

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"path"
	"strings"
)

// Categories 是商店的应用分类。
var Categories = map[string]string{
	"productivity":  "效率",
	"tools":         "工具",
	"monitoring":    "监控",
	"data":          "数据",
	"communication": "沟通",
	"developer":     "开发",
	"other":         "其他",
}

// Licenses 是接受的开源许可证（SPDX 标识）。
var Licenses = map[string]bool{
	"MIT": true, "Apache-2.0": true, "BSD-2-Clause": true, "BSD-3-Clause": true, "ISC": true,
	"MPL-2.0": true, "LGPL-3.0-only": true, "LGPL-3.0-or-later": true,
	"GPL-3.0-only": true, "GPL-3.0-or-later": true, "AGPL-3.0-only": true, "AGPL-3.0-or-later": true,
}

// Pricing 取值：free 免费；freemium 基础免费、增值服务收费；subscription 需要订阅外部服务。
var Pricing = map[string]bool{"free": true, "freemium": true, "subscription": true}

// 截图限制。
const (
	MaxScreenshots    = 5
	MaxScreenshotSize = 512 << 10
)

var screenshotTypes = map[string]string{".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}

// Meta 是应用目录下 store.json 的内容：只在商店展示，不进入安装包。
type Meta struct {
	Summary     string   `json:"summary"`
	Category    string   `json:"category"`
	Tags        []string `json:"tags,omitempty"`
	Authors     []Author `json:"authors"`
	License     string   `json:"license"`
	Homepage    string   `json:"homepage,omitempty"`
	Repository  string   `json:"repository,omitempty"`
	Pricing     string   `json:"pricing,omitempty"`
	PricingURL  string   `json:"pricingUrl,omitempty"`
	Screenshots []string `json:"screenshots,omitempty"`
	Withdrawn   bool     `json:"withdrawn,omitempty"`
	Yanked      []string `json:"yanked,omitempty"`
}

// Author 是应用作者或维护者。
type Author struct {
	Name string `json:"name"`
	URL  string `json:"url,omitempty"`
}

// ParseMeta 严格解析 store.json。
func ParseMeta(raw []byte) (Meta, error) {
	var meta Meta
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&meta); err != nil {
		return meta, fmt.Errorf("store.json 无法解析：%w", err)
	}
	if meta.Pricing == "" {
		meta.Pricing = "free"
	}
	return meta, meta.validate()
}

func (m Meta) validate() error {
	if summary := []rune(strings.TrimSpace(m.Summary)); len(summary) == 0 || len(summary) > 80 {
		return errors.New("store.json 的 summary 必须是 1-80 个字符")
	}
	if _, ok := Categories[m.Category]; !ok {
		return fmt.Errorf("store.json 的 category %q 无效", m.Category)
	}
	if len(m.Tags) > 8 {
		return errors.New("store.json 的 tags 最多 8 个")
	}
	for _, tag := range m.Tags {
		if tag == "" || len([]rune(tag)) > 20 {
			return errors.New("store.json 的 tag 必须是 1-20 个字符")
		}
	}
	if len(m.Authors) == 0 || len(m.Authors) > 8 {
		return errors.New("store.json 必须声明 1-8 位作者")
	}
	for _, author := range m.Authors {
		if strings.TrimSpace(author.Name) == "" || len([]rune(author.Name)) > 64 {
			return errors.New("store.json 的作者名称必须是 1-64 个字符")
		}
		if err := validLink(author.URL); err != nil {
			return fmt.Errorf("作者 %s 的 url：%w", author.Name, err)
		}
	}
	if !Licenses[m.License] {
		return fmt.Errorf("store.json 的 license %q 不在接受的开源许可证列表中", m.License)
	}
	for name, link := range map[string]string{"homepage": m.Homepage, "repository": m.Repository, "pricingUrl": m.PricingURL} {
		if err := validLink(link); err != nil {
			return fmt.Errorf("store.json 的 %s：%w", name, err)
		}
	}
	if !Pricing[m.Pricing] {
		return fmt.Errorf("store.json 的 pricing %q 无效", m.Pricing)
	}
	if m.Pricing != "free" && m.PricingURL == "" {
		return errors.New("收费或需订阅的应用必须提供 pricingUrl")
	}
	if len(m.Screenshots) > MaxScreenshots {
		return fmt.Errorf("store.json 最多 %d 张截图", MaxScreenshots)
	}
	for _, name := range m.Screenshots {
		if !safeRootName(name) || screenshotTypes[strings.ToLower(path.Ext(name))] == "" {
			return fmt.Errorf("截图 %q 必须是 screenshots 目录下的 PNG / JPEG / WebP 文件", name)
		}
	}
	for _, version := range m.Yanked {
		if !ValidVersion(version) {
			return fmt.Errorf("store.json 的 yanked 版本 %q 无效", version)
		}
	}
	return nil
}

// ScreenshotType 返回截图文件的 MIME 类型，不支持时返回空字符串。
func ScreenshotType(name string) string { return screenshotTypes[strings.ToLower(path.Ext(name))] }

// IsYanked 判断版本是否被撤回。
func (m Meta) IsYanked(version string) bool {
	for _, yanked := range m.Yanked {
		if yanked == version {
			return true
		}
	}
	return false
}

func validLink(raw string) error {
	if raw == "" {
		return nil
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || len(raw) > 512 {
		return errors.New("必须是不超过 512 字符的 https 地址")
	}
	return nil
}

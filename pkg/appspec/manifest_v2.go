package appspec

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"regexp"
	"slices"
	"strings"
)

// 格式 2 的清单字段：requires、access、surfaces、platform。backend、mcp、skills 分别见同目录文件。
// 合同见 docs/spec/01-package-v2.md。

// PlatformVersion 是商店当前认识的平台接口大版本。
const PlatformVersion = 1

var (
	accessPermissionPattern = regexp.MustCompile(`^[a-z][a-z0-9_.-]{1,47}$`)
	aliasPattern            = regexp.MustCompile(`^/[a-z0-9][a-z0-9-]*(/[a-z0-9][a-z0-9-]*){0,3}$`)
)

// Requires 声明所需的平台接口大版本。
type Requires struct {
	Platform int `json:"platform"`
}

// Access 声明应用内权限与默认授予。
type Access struct {
	Permissions  []AccessPermission `json:"permissions,omitempty"`
	DefaultGrant string             `json:"default_grant,omitempty"`
}

// AccessPermission 是一个应用内权限，目标系统登记为 <slug>:<name>。
type AccessPermission struct {
	Name    string `json:"name"`
	Title   string `json:"title"`
	Default bool   `json:"default,omitempty"`
}

// Surfaces 声明界面入口与页面可见范围。
type Surfaces struct {
	Home       string         `json:"home,omitempty"`
	Window     *SurfacePages  `json:"window,omitempty"`
	Standalone *Standalone    `json:"standalone,omitempty"`
	Public     *PublicSurface `json:"public,omitempty"`
}

// SurfacePages 是一个入口的页面规则。
type SurfacePages struct {
	Pages []PageRule `json:"pages,omitempty"`
}

// PageRule 按路径前缀指定可见范围。
type PageRule struct {
	Path       string `json:"path"`
	Visibility string `json:"visibility"`
}

// Standalone 控制是否允许在浏览器新标签页打开。
type Standalone struct {
	Enabled bool `json:"enabled"`
}

// PublicSurface 是未登录可访问的公开入口。
type PublicSurface struct {
	Pages   []PageRule `json:"pages,omitempty"`
	Alias   string     `json:"alias,omitempty"`
	Session string     `json:"session,omitempty"`
}

// Platform 声明使用的平台能力与提供的扩展点。
type Platform struct {
	Uses     []string                   `json:"uses,omitempty"`
	Provides map[string]json.RawMessage `json:"provides,omitempty"`
}

// PlatformCapabilities 是平台接口 v1 的能力名。
var PlatformCapabilities = map[string]bool{
	"identity": true, "directory.pick": true, "ui": true, "notify": true, "files.pick": true, "files.save": true,
	"files.reference": true, "workspace.state": true, "image.sanitize": true, "ai.complete": true, "ai.image": true,
	"tasks": true, "realtime": true, "audit": true,
}

// ExtensionPoints 是扩展点名，值表示是否需要后端模块。
var ExtensionPoints = map[string]bool{
	"settings": false, "open_with": false, "widget": false,
	"lifecycle": true, "account_deleted": true, "health": true, "search": true, "notification_action": true, "export": true,
	"builtin_import": true,
}

// BuiltinImportSources 是 builtin_import 扩展点可声明的内置功能配置来源。
var BuiltinImportSources = []string{"articles.site"}

// reservedAliases 是公开入口不能占用的站点路径（目标系统还可能保留更多）。
var reservedAliases = []string{"/api", "/xyzos", "/custom", "/apps", "/app", "/p", "/s", "/sdk", "/assets", "/static", "/healthz", "/setup", "/login", "/logout"}

// formatTwoField 返回清单中出现的第一个格式 2 字段名，没有时为空。
func (m *Manifest) formatTwoField() string {
	switch {
	case m.Requires != nil:
		return "requires"
	case m.Access != nil:
		return "access"
	case m.Surfaces != nil:
		return "surfaces"
	case m.Platform != nil:
		return "platform"
	case m.Backend != nil:
		return "backend"
	case m.MCP != nil:
		return "mcp"
	case m.Skills != nil:
		return "skills"
	}
	return ""
}

// HasUI 表示应用是否有窗口界面。
func (m Manifest) HasUI() bool { return m.Entry != "" || m.GatewayPage != nil }

// RequiredPlatform 返回所需的平台接口大版本，未声明时为 1。
func (m Manifest) RequiredPlatform() int {
	if m.Requires == nil || m.Requires.Platform == 0 {
		return 1
	}
	return m.Requires.Platform
}

func (m *Manifest) validateFormatTwo(files []File) error {
	if !m.HasUI() && m.MCP == nil && len(m.Skills) == 0 {
		return errors.New("格式 2 的应用至少要包含界面（entry / gateway_page）、mcp 或 skills 之一")
	}
	if !m.HasUI() {
		switch {
		case m.DesktopWidget || m.Widget != nil:
			return errors.New("没有界面的应用不能声明桌面卡片")
		case m.Window != nil:
			return errors.New("没有界面的应用不能声明 window")
		case m.Surfaces != nil:
			return errors.New("没有界面的应用不能声明 surfaces")
		}
	}
	if m.Requires != nil && (m.Requires.Platform < 1 || m.Requires.Platform > PlatformVersion) {
		return fmt.Errorf("requires.platform 只支持 1-%d", PlatformVersion)
	}
	if err := m.validateAccess(); err != nil {
		return err
	}
	if err := m.validateBackend(files); err != nil {
		return err
	}
	if err := m.validateSurfaces(); err != nil {
		return err
	}
	if err := m.validatePlatform(); err != nil {
		return err
	}
	if err := m.validateMCP(files); err != nil {
		return err
	}
	return m.validateSkills(files)
}

func (m *Manifest) validateAccess() error {
	if m.Access == nil {
		return nil
	}
	switch m.Access.DefaultGrant {
	case "", "none", "all_accounts", "all_accounts_and_new":
	default:
		return errors.New("access.default_grant 只支持 none、all_accounts、all_accounts_and_new")
	}
	if len(m.Access.Permissions) > 32 {
		return errors.New("access.permissions 过多（上限 32）")
	}
	seen := map[string]bool{}
	for i, permission := range m.Access.Permissions {
		if !accessPermissionPattern.MatchString(permission.Name) {
			return fmt.Errorf("access.permissions 第 %d 项的 name 格式无效", i+1)
		}
		if seen[permission.Name] {
			return fmt.Errorf("access.permissions 中的 %q 重复", permission.Name)
		}
		seen[permission.Name] = true
		if title := strings.TrimSpace(permission.Title); title == "" || len([]rune(permission.Title)) > 32 {
			return fmt.Errorf("access.permissions 中 %q 的 title 必须是 1-32 个字符", permission.Name)
		}
	}
	return nil
}

func (m *Manifest) hasAccessPermission(name string) bool {
	if m.Access == nil {
		return false
	}
	for _, permission := range m.Access.Permissions {
		if permission.Name == name {
			return true
		}
	}
	return false
}

// checkVisibility 校验可见范围；allowPublic 表示该位置允许 public。
func (m *Manifest) checkVisibility(value string, allowPublic bool) error {
	switch value {
	case "app", "signed_in":
		return nil
	case "public":
		if !allowPublic {
			return errors.New("这里不能使用 public 可见范围")
		}
		return nil
	}
	name, ok := strings.CutPrefix(value, "permission:")
	if !ok {
		return fmt.Errorf("可见范围 %q 无效：只支持 public、signed_in、app、permission:<name>", value)
	}
	if !m.hasAccessPermission(name) {
		return fmt.Errorf("可见范围 %q 引用的应用内权限没有在 access.permissions 中声明", value)
	}
	return nil
}

func (m *Manifest) validateSurfaces() error {
	s := m.Surfaces
	if s == nil {
		return nil
	}
	if s.Home != "" {
		if _, err := normalizeAllowedPath(s.Home); err != nil {
			return fmt.Errorf("surfaces.home：%w", err)
		}
	}
	if s.Window != nil {
		if err := m.validatePageRules("surfaces.window", s.Window.Pages, false); err != nil {
			return err
		}
	}
	if s.Public != nil {
		switch s.Public.Session {
		case "", "none", "optional":
		default:
			return errors.New("surfaces.public.session 只支持 none 或 optional")
		}
		if len(s.Public.Pages) == 0 {
			return errors.New("surfaces.public 至少要声明一个页面")
		}
		if err := m.validatePageRules("surfaces.public", s.Public.Pages, true); err != nil {
			return err
		}
		if s.Public.Session != "optional" {
			for _, page := range s.Public.Pages {
				if page.Visibility != "public" {
					return errors.New("surfaces.public 未开启 session: optional 时，页面只能是 public")
				}
			}
		}
		if alias := s.Public.Alias; alias != "" {
			if !aliasPattern.MatchString(alias) {
				return errors.New("surfaces.public.alias 必须是 /小写路径，最多 4 段，不以 / 结尾")
			}
			for _, reserved := range reservedAliases {
				if alias == reserved || strings.HasPrefix(alias, reserved+"/") {
					return fmt.Errorf("surfaces.public.alias %q 占用了保留路径 %s", alias, reserved)
				}
			}
		}
	}
	return nil
}

func (m *Manifest) validatePageRules(field string, pages []PageRule, allowPublic bool) error {
	if len(pages) > 32 {
		return fmt.Errorf("%s.pages 过多（上限 32）", field)
	}
	seen := map[string]bool{}
	for i := range pages {
		clean, err := normalizeAllowedPath(pages[i].Path)
		if err != nil {
			return fmt.Errorf("%s.pages 第 %d 项的 path：%w", field, i+1, err)
		}
		if seen[clean] {
			return fmt.Errorf("%s.pages 中的路径 %q 重复", field, clean)
		}
		seen[clean] = true
		pages[i].Path = clean
		if err := m.checkVisibility(pages[i].Visibility, allowPublic); err != nil {
			return fmt.Errorf("%s.pages 第 %d 项：%w", field, i+1, err)
		}
	}
	return nil
}

func (m *Manifest) validatePlatform() error {
	p := m.Platform
	if p == nil {
		return nil
	}
	if len(p.Uses) > len(PlatformCapabilities) {
		return errors.New("platform.uses 过多")
	}
	seen := map[string]bool{}
	for _, name := range p.Uses {
		if !PlatformCapabilities[name] {
			return fmt.Errorf("platform.uses 中的 %q 不是平台接口 v1 的能力", name)
		}
		if seen[name] {
			return fmt.Errorf("platform.uses 中的 %q 重复", name)
		}
		seen[name] = true
	}
	for name, raw := range p.Provides {
		needsBackend, known := ExtensionPoints[name]
		if !known {
			return fmt.Errorf("platform.provides 中的 %q 不是已知扩展点", name)
		}
		if needsBackend && m.Backend == nil {
			return fmt.Errorf("扩展点 %q 需要后端模块（backend）", name)
		}
		if len(raw) > 8<<10 {
			return fmt.Errorf("扩展点 %q 的参数超过 8 KB", name)
		}
		var params struct {
			Route string `json:"route"`
		}
		if json.Unmarshal(raw, &params) == nil && params.Route != "" && !m.Backend.hasRoute(params.Route, "POST") {
			return fmt.Errorf("扩展点 %q 的 route %q 没有在 backend.routes 中以 POST 声明", name, params.Route)
		}
		if name == "builtin_import" {
			if err := m.validateBuiltinImport(raw); err != nil {
				return err
			}
		}
	}
	return nil
}

// fileByPath 在包文件中查找指定路径。
func fileByPath(files []File, name string) (File, bool) {
	clean := path.Clean(name)
	for _, file := range files {
		if file.Path == clean {
			return file, true
		}
	}
	return File{}, false
}

// validateBuiltinImport 校验 builtin_import：{ sources: [...], route: "/..." }，来源只能是 BuiltinImportSources 中的项，route 必填。
func (m *Manifest) validateBuiltinImport(raw json.RawMessage) error {
	var spec struct {
		Sources []string `json:"sources"`
		Route   string   `json:"route"`
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&spec); err != nil {
		return errors.New("builtin_import 的参数格式无效（须为 {\"sources\": [...], \"route\": \"/...\"}）")
	}
	if len(spec.Sources) == 0 || len(spec.Sources) > len(BuiltinImportSources) {
		return fmt.Errorf("builtin_import.sources 须有 1-%d 项", len(BuiltinImportSources))
	}
	seen := map[string]bool{}
	for _, source := range spec.Sources {
		if !slices.Contains(BuiltinImportSources, source) || seen[source] {
			return fmt.Errorf("builtin_import.sources 中的 %q 无效或重复", source)
		}
		seen[source] = true
	}
	if spec.Route == "" {
		return errors.New("builtin_import.route 必填")
	}
	// 导入以管理员身份执行，命中的 POST 路由都不能是 public。
	for _, route := range m.Backend.Routes {
		matches := route.Path == spec.Route
		if prefix, ok := strings.CutSuffix(route.Path, "*"); ok {
			matches = strings.HasPrefix(spec.Route, prefix)
		}
		if matches && slices.Contains(route.Methods, "POST") && route.Visibility == "public" {
			return fmt.Errorf("builtin_import.route %q 不能是 public 路由", spec.Route)
		}
	}
	return nil
}

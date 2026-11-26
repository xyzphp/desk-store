// Package appspec 定义应用安装包（format 1 与 format 2）的结构与校验规则。
// 格式 2 的合同见仓库 docs/spec/。
//
// 规则与 XYZOS 安装时的校验保持一致：商店和 appcheck 用它提前发现问题，
// 但目标系统安装时仍会独立完整校验，并可能保留更多 slug（例如内建应用标识）。
package appspec

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"
)

// 清单与图标限制；包体积与文件数按格式区分，见 limits.go。
const (
	MaxIconSize        = 64 << 10
	MaxManifestSize    = 32 << 10
	maxProxyResponse   = 1 << 20
	maxManifestSizeTwo = 64 << 10
)

var (
	slugPattern    = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,31}$`)
	versionPattern = regexp.MustCompile(`^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.~-]+)?$`)
)

// reservedSlugs 是与网关路由冲突的通用保留字。目标系统还会保留自己的内建应用标识。
var reservedSlugs = map[string]bool{
	"api": true, "custom": true, "brand": true, "static": true, "assets": true,
	"apps": true, "sdk": true, "js": true, "css": true, "img": true,
	"healthz": true, "verify": true, "logout": true, "account": true, "settings": true,
}

const reservedSlugPrefix = "data-app-"

// FileTypes 是包内文件扩展名对应的 MIME 类型；各格式允许哪些扩展名见 limits.go。
var FileTypes = map[string]string{
	".md":    "text/markdown; charset=utf-8",
	".sql":   "application/sql",
	".wasm":  "application/wasm",
	".map":   "application/json; charset=utf-8",
	".html":  "text/html; charset=utf-8",
	".css":   "text/css; charset=utf-8",
	".js":    "text/javascript; charset=utf-8",
	".json":  "application/json; charset=utf-8",
	".svg":   "image/svg+xml",
	".png":   "image/png",
	".jpg":   "image/jpeg",
	".jpeg":  "image/jpeg",
	".webp":  "image/webp",
	".woff2": "font/woff2",
	".txt":   "text/plain; charset=utf-8",
}

var iconTypes = map[string]bool{".svg": true, ".png": true, ".jpg": true, ".jpeg": true, ".webp": true}

// Manifest 是 manifest.json 的结构。解析时拒绝未知字段。
type Manifest struct {
	Format        int          `json:"format"`
	Slug          string       `json:"slug"`
	Name          string       `json:"name"`
	Version       string       `json:"version"`
	Description   string       `json:"description"`
	Entry         string       `json:"entry,omitempty"`
	GatewayPage   *GatewayPage `json:"gateway_page,omitempty"`
	Icon          string       `json:"icon"`
	DesktopWidget bool         `json:"desktop_widget,omitempty"`
	Widget        *Widget      `json:"widget,omitempty"`
	Window        *WindowSize  `json:"window,omitempty"`
	GatewayAPI    []string     `json:"gateway_api,omitempty"`
	Permissions   []string     `json:"permissions,omitempty"`
	Proxies       []Proxy      `json:"proxies,omitempty"`

	// 格式 2 新增，见 docs/spec/01-package-v2.md。
	Requires *Requires `json:"requires,omitempty"`
	Access   *Access   `json:"access,omitempty"`
	Surfaces *Surfaces `json:"surfaces,omitempty"`
	Platform *Platform `json:"platform,omitempty"`
	Backend  *Backend  `json:"backend,omitempty"`
	MCP      *MCP      `json:"mcp,omitempty"`
	Skills   []string  `json:"skills,omitempty"`

	// skills 解析结果，供摘要使用，不出现在 JSON 中。
	skillInfo []SkillInfo
}

// GatewayPage 声明由网关代理加载的上游页面。
type GatewayPage struct {
	Proxy string `json:"proxy"`
	Path  string `json:"path"`
}

// WindowSize 是应用窗口的初始尺寸。
type WindowSize struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

// Proxy 是一条受控接口代理声明。
type Proxy struct {
	Key              string   `json:"key"`
	Title            string   `json:"title"`
	Upstream         string   `json:"upstream"`
	BaseURLEditable  bool     `json:"base_url_editable,omitempty"`
	AuthType         string   `json:"auth_type"`
	AuthHeader       string   `json:"auth_header,omitempty"`
	Paths            []string `json:"paths"`
	Methods          []string `json:"methods,omitempty"`
	PassQuery        bool     `json:"pass_query,omitempty"`
	TimeoutMS        int      `json:"timeout_ms,omitempty"`
	MaxResponseBytes int      `json:"max_response_bytes,omitempty"`
}

// ParseManifest 严格解析并校验清单；files 为包内除清单外的文件（用于检查入口与图标）。
func ParseManifest(raw []byte, files []File) (Manifest, error) {
	var manifest Manifest
	if len(raw) == 0 {
		return manifest, errors.New("缺少 manifest.json")
	}
	if len(raw) > maxManifestSizeTwo {
		return manifest, errors.New("manifest.json 超过大小限制（格式 1 为 32 KB，格式 2 为 64 KB）")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&manifest); err != nil {
		return manifest, fmt.Errorf("manifest.json 无法解析：%w", err)
	}
	if manifest.Format == 1 && len(raw) > MaxManifestSize {
		return manifest, errors.New("manifest.json 超过大小限制（32 KB）")
	}
	if err := checkFormatLimits(manifest.Format, len(raw), files); err != nil {
		return manifest, err
	}
	if err := manifest.validate(files); err != nil {
		return manifest, err
	}
	return manifest, nil
}

// ValidSlug 判断应用标识格式（不含保留字检查）。
func ValidSlug(value string) bool {
	return slugPattern.MatchString(value) && !strings.HasSuffix(value, "-")
}

// ValidVersion 判断版本号是否为 semver 形态。
func ValidVersion(value string) bool { return versionPattern.MatchString(value) }

func (m *Manifest) validate(files []File) error {
	if m.Format != 1 && m.Format != 2 {
		return errors.New("manifest 的 format 只支持 1 或 2")
	}
	if field := m.formatTwoField(); m.Format == 1 && field != "" {
		return fmt.Errorf("manifest 使用了格式 2 的字段 %s，format 必须为 2", field)
	}
	if !ValidSlug(m.Slug) {
		return errors.New("manifest 的 slug 只允许 2-32 位小写字母、数字或连字符，且以字母或数字开头、不以连字符结尾")
	}
	if reservedSlugs[m.Slug] || strings.HasPrefix(m.Slug, reservedSlugPrefix) {
		return errors.New("manifest 的 slug 与保留标识冲突，请更换")
	}
	if m.Name == "" || len([]rune(m.Name)) > 64 {
		return errors.New("manifest 的 name 必须是 1-64 个字符")
	}
	if !ValidVersion(m.Version) {
		return errors.New("manifest 的 version 必须是 semver 版本号，例如 1.0.0")
	}
	if len([]rune(m.Description)) > 400 {
		return errors.New("manifest 的 description 不能超过 400 个字符")
	}
	if m.Entry != "" && m.GatewayPage != nil {
		return errors.New("manifest 只能声明 entry 或 gateway_page 其中之一")
	}
	if m.Format == 1 && m.Entry == "" && m.GatewayPage == nil {
		return errors.New("manifest 必须且只能声明 entry 或 gateway_page")
	}
	if m.Entry != "" && (!safeRootName(m.Entry) || path.Ext(m.Entry) != ".html") {
		return errors.New("manifest 的 entry 必须是包根目录的 .html 文件")
	}
	if !safeRootName(m.Icon) || !iconTypes[strings.ToLower(path.Ext(m.Icon))] {
		return errors.New("manifest 的 icon 必须是包根目录的 SVG / PNG / JPEG / WebP 文件")
	}
	if len(m.Permissions) > 16 || len(m.Proxies) > 8 {
		return errors.New("manifest 的权限点或代理声明过多")
	}
	keys := make(map[string]bool, len(m.Proxies))
	for i := range m.Proxies {
		if err := m.Proxies[i].validate(i, keys); err != nil {
			return err
		}
	}
	for _, permission := range m.Permissions {
		key, ok := strings.CutPrefix(permission, "proxy.")
		if !ok || key == "" {
			return fmt.Errorf("权限点 %q 无效：当前只支持 proxy.<key>", permission)
		}
		if !keys[key] {
			return fmt.Errorf("权限点 %q 没有对应的代理声明", permission)
		}
	}
	if err := m.validateGatewayPage(); err != nil {
		return err
	}
	if err := validateGatewayAPI(m.GatewayAPI); err != nil {
		return err
	}
	if err := validateWidget(m); err != nil {
		return err
	}
	if m.Window != nil && (m.Window.Width < 320 || m.Window.Width > 3840 || m.Window.Height < 240 || m.Window.Height > 2160) {
		return errors.New("manifest 的 window 尺寸无效（宽 320-3840，高 240-2160）")
	}
	entryFound, iconFound := m.Entry == "", false
	for _, file := range files {
		switch file.Path {
		case m.Entry:
			entryFound = true
		case m.Icon:
			iconFound = true
			if len(file.Content) > MaxIconSize {
				return errors.New("应用图标超过大小限制（64 KB）")
			}
		}
	}
	if !entryFound {
		return fmt.Errorf("manifest 的 entry %q 在安装包中不存在", m.Entry)
	}
	if !iconFound {
		return fmt.Errorf("manifest 的 icon %q 在安装包中不存在", m.Icon)
	}
	if m.Format == 2 {
		return m.validateFormatTwo(files)
	}
	return nil
}

func (p *Proxy) validate(index int, keys map[string]bool) error {
	if !ValidSlug(p.Key) {
		return fmt.Errorf("代理 %d 的 key 格式无效", index+1)
	}
	if keys[p.Key] {
		return fmt.Errorf("代理 key %q 重复", p.Key)
	}
	keys[p.Key] = true
	if strings.TrimSpace(p.Title) == "" || len([]rune(p.Title)) > 64 {
		return fmt.Errorf("代理 %q 的 title 必须是 1-64 个字符", p.Key)
	}
	upstream, err := normalizeUpstream(p.Upstream)
	if err != nil {
		return fmt.Errorf("代理 %q：%w", p.Key, err)
	}
	p.Upstream = upstream
	switch p.AuthType {
	case "none", "bearer", "basic":
	case "header":
		if !validHeaderName(p.AuthHeader) {
			return fmt.Errorf("代理 %q 使用 header 鉴权时必须提供合法的 auth_header", p.Key)
		}
	default:
		return fmt.Errorf("代理 %q 的 auth_type 只支持 none、bearer、basic、header", p.Key)
	}
	if len(p.Paths) == 0 || len(p.Paths) > 12 {
		return fmt.Errorf("代理 %q 必须声明 1-12 个路径白名单", p.Key)
	}
	seen := make(map[string]bool, len(p.Paths))
	for i, allowed := range p.Paths {
		clean, err := normalizeAllowedPath(allowed)
		if err != nil {
			return fmt.Errorf("代理 %q 路径白名单第 %d 项：%w", p.Key, i+1, err)
		}
		if seen[clean] {
			return fmt.Errorf("代理 %q 路径白名单第 %d 项重复", p.Key, i+1)
		}
		seen[clean] = true
		p.Paths[i] = clean
	}
	if len(p.Methods) == 0 {
		p.Methods = []string{http.MethodGet}
	}
	if len(p.Methods) > 8 {
		return fmt.Errorf("代理 %q 的方法白名单过多", p.Key)
	}
	for _, method := range p.Methods {
		switch method {
		case http.MethodGet, http.MethodHead, http.MethodPost, http.MethodPut, http.MethodDelete:
		default:
			return fmt.Errorf("代理 %q 的方法白名单只支持 GET、HEAD、POST、PUT、DELETE", p.Key)
		}
	}
	if p.TimeoutMS == 0 {
		p.TimeoutMS = 5000
	}
	if p.TimeoutMS < 1000 || p.TimeoutMS > 30000 {
		return fmt.Errorf("代理 %q 的 timeout_ms 必须在 1000-30000 之间", p.Key)
	}
	if p.MaxResponseBytes == 0 {
		p.MaxResponseBytes = 256 << 10
	}
	if p.MaxResponseBytes < 1024 || p.MaxResponseBytes > maxProxyResponse {
		return fmt.Errorf("代理 %q 的 max_response_bytes 必须在 1024-1048576 之间", p.Key)
	}
	return nil
}

func (p Proxy) allowsMethod(method string) bool {
	for _, allowed := range p.Methods {
		if allowed == method {
			return true
		}
	}
	return false
}

func (p Proxy) allowsPath(requestPath string) bool {
	normalized, ok := normalizeProxyPath(requestPath)
	if !ok {
		return false
	}
	for _, allowed := range p.Paths {
		if normalized == allowed || strings.HasPrefix(normalized, strings.TrimRight(allowed, "/")+"/") {
			return true
		}
	}
	return false
}

func (m *Manifest) proxy(key string) (Proxy, bool) {
	for _, proxy := range m.Proxies {
		if proxy.Key == key {
			return proxy, true
		}
	}
	return Proxy{}, false
}

func (m *Manifest) hasPermission(key string) bool {
	for _, permission := range m.Permissions {
		if permission == "proxy."+key {
			return true
		}
	}
	return false
}

func (m *Manifest) validateGatewayPage() error {
	page := m.GatewayPage
	if page == nil {
		return nil
	}
	if !ValidSlug(page.Proxy) {
		return errors.New("manifest 的 gateway_page.proxy 格式无效")
	}
	pagePath, err := normalizeAllowedPath(page.Path)
	if err != nil {
		return fmt.Errorf("manifest 的 gateway_page.path：%w", err)
	}
	page.Path = pagePath
	proxy, found := m.proxy(page.Proxy)
	if !found {
		return errors.New("manifest 的 gateway_page.proxy 没有对应的代理声明")
	}
	if !proxy.allowsPath(page.Path) || !proxy.allowsMethod(http.MethodGet) {
		return errors.New("gateway_page 页面路径必须在代理白名单内，且代理须允许 GET")
	}
	if !m.hasPermission(page.Proxy) {
		return fmt.Errorf("gateway_page 代理 %q 必须声明对应的 proxy 权限点", page.Proxy)
	}
	return nil
}

// validateGatewayAPI 只允许 /xyzos/api/ 命名空间下的规范路径前缀，并规整为尾斜杠形式。
func validateGatewayAPI(scopes []string) error {
	if len(scopes) > 8 {
		return errors.New("gateway_api 声明过多（上限 8 条）")
	}
	seen := make(map[string]bool, len(scopes))
	for i, scope := range scopes {
		if scope == "" || len(scope) > 128 || strings.ContainsAny(scope, "\\#? \t\r\n") {
			return fmt.Errorf("gateway_api 第 %d 项 %q 无效", i+1, scope)
		}
		if !strings.HasPrefix(scope, "/xyzos/api/") {
			return fmt.Errorf("gateway_api 第 %d 项 %q 无效：只支持 /xyzos/api/ 前缀", i+1, scope)
		}
		clean := path.Clean(scope)
		if clean != scope && clean+"/" != scope {
			return fmt.Errorf("gateway_api 第 %d 项 %q 不是规范路径", i+1, scope)
		}
		if !strings.HasSuffix(clean, "/") {
			clean += "/"
		}
		if seen[clean] {
			return fmt.Errorf("gateway_api 第 %d 项 %q 重复", i+1, scope)
		}
		seen[clean] = true
		scopes[i] = clean
	}
	return nil
}

// safeRootName 只接受包根目录下的普通文件名。
func safeRootName(name string) bool {
	if name == "" || strings.ContainsRune(name, '\\') || strings.HasPrefix(name, "/") {
		return false
	}
	clean := path.Clean(name)
	if clean != name || clean == "." || strings.HasPrefix(clean, "../") {
		return false
	}
	return !strings.ContainsRune(clean, '/')
}

func normalizeUpstream(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" || len(value) > 2048 {
		return "", errors.New("upstream 地址无效")
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Opaque != "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("upstream 不能包含账号、查询参数或片段")
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return "", errors.New("upstream 只支持 http/https")
	}
	host := strings.TrimSuffix(strings.ToLower(parsed.Hostname()), ".")
	if host == "" || strings.Contains(host, "%") {
		return "", errors.New("upstream 主机名无效")
	}
	if port := parsed.Port(); port != "" {
		if number, err := strconv.Atoi(port); err != nil || number < 1 || number > 65535 {
			return "", errors.New("upstream 端口无效")
		}
	}
	if strings.ContainsAny(parsed.Path, "\\\r\n\x00") || strings.Contains(parsed.Path, "//") {
		return "", errors.New("upstream 路径无效")
	}
	for _, segment := range strings.Split(parsed.Path, "/") {
		if segment == "." || segment == ".." {
			return "", errors.New("upstream 路径不允许目录跳转")
		}
	}
	normalized := &url.URL{Scheme: scheme, Host: parsed.Host, Path: strings.TrimRight(parsed.Path, "/")}
	return normalized.String(), nil
}

func normalizeAllowedPath(allowed string) (string, error) {
	if allowed == "" || !strings.HasPrefix(allowed, "/") || len(allowed) > 256 {
		return "", errors.New("必须是以 / 开头且不超过 256 字符的路径")
	}
	normalized, ok := normalizeProxyPath(allowed)
	if !ok || len(normalized) > 256 {
		return "", errors.New("路径不允许包含查询、片段、目录跳转或重复分隔符")
	}
	return normalized, nil
}

func normalizeProxyPath(value string) (string, bool) {
	if value == "" || !strings.HasPrefix(value, "/") || len(value) > 4096 || strings.ContainsAny(value, "?#\\\r\n\x00") {
		return "", false
	}
	decoded, err := url.PathUnescape(value)
	if err != nil || strings.ContainsAny(decoded, "?#%\\\r\n\x00") || strings.Contains(decoded, "//") {
		return "", false
	}
	for _, segment := range strings.Split(decoded, "/") {
		if segment == "." || segment == ".." {
			return "", false
		}
	}
	return decoded, true
}

func validHeaderName(name string) bool {
	if name == "" || len(name) > 64 {
		return false
	}
	for _, char := range name {
		if (char < 'a' || char > 'z') && (char < 'A' || char > 'Z') && (char < '0' || char > '9') && char != '-' {
			return false
		}
	}
	return true
}

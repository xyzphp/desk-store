package appspec

import (
	"fmt"
	"sort"
	"strings"
)

// 能力标记：清单用到的、并非所有目标系统都支持的特性。
const (
	CapabilityGatewayPage     = "gateway_page"
	CapabilityGatewayAPI      = "gateway_api"
	CapabilityDesktopWidget   = "desktop_widget"
	CapabilityWidget          = "widget"
	CapabilityAccountSelector = "widget.account_selector"
	CapabilityWindow          = "window"
)

// Summary 是从清单提取、供展示与评审的权限摘要。
type Summary struct {
	Entry         string         `json:"entry"` // entry 或 gateway_page
	GatewayAPI    []string       `json:"gatewayApi"`
	Proxies       []ProxySummary `json:"proxies"`
	DesktopWidget bool           `json:"desktopWidget"`
	Capabilities  []string       `json:"capabilities"`

	// 格式 2，见 summary_v2.go；格式 1 的应用省略这些字段。
	Access   *AccessSummary   `json:"access,omitempty"`
	Surfaces *SurfacesSummary `json:"surfaces,omitempty"`
	Backend  *BackendSummary  `json:"backend,omitempty"`
	Platform *PlatformSummary `json:"platform,omitempty"`
	MCP      *MCPSummary      `json:"mcp,omitempty"`
	Skills   []SkillInfo      `json:"skills,omitempty"`
}

// ProxySummary 描述一条代理的可达范围。
type ProxySummary struct {
	Key             string   `json:"key"`
	Title           string   `json:"title"`
	Upstream        string   `json:"upstream"`
	BaseURLEditable bool     `json:"baseUrlEditable"`
	AuthType        string   `json:"authType"`
	NeedsCredential bool     `json:"needsCredential"`
	Methods         []string `json:"methods"`
	Paths           []string `json:"paths"`
	PassQuery       bool     `json:"passQuery"`
}

// Summarize 生成权限摘要；切片总是非 nil，便于 JSON 输出为空数组。
func (m Manifest) Summarize() Summary {
	summary := Summary{Entry: "entry", GatewayAPI: append([]string{}, m.GatewayAPI...), Proxies: []ProxySummary{}, DesktopWidget: m.DesktopWidget}
	switch {
	case m.GatewayPage != nil:
		summary.Entry = "gateway_page"
	case !m.HasUI():
		summary.Entry = "none"
	}
	for _, proxy := range m.Proxies {
		summary.Proxies = append(summary.Proxies, ProxySummary{
			Key: proxy.Key, Title: proxy.Title, Upstream: proxy.Upstream, BaseURLEditable: proxy.BaseURLEditable,
			AuthType: proxy.AuthType, NeedsCredential: proxy.AuthType != "none",
			Methods: append([]string{}, proxy.Methods...), Paths: append([]string{}, proxy.Paths...), PassQuery: proxy.PassQuery,
		})
	}
	summary.Capabilities = m.Capabilities()
	m.summarizeFormatTwo(&summary)
	return summary
}

// Capabilities 返回清单用到的能力标记（排序后）。
func (m Manifest) Capabilities() []string {
	capabilities := []string{}
	if m.GatewayPage != nil {
		capabilities = append(capabilities, CapabilityGatewayPage)
	}
	if len(m.GatewayAPI) > 0 {
		capabilities = append(capabilities, CapabilityGatewayAPI)
	}
	if m.DesktopWidget {
		capabilities = append(capabilities, CapabilityDesktopWidget)
	}
	if m.Widget != nil {
		capabilities = append(capabilities, CapabilityWidget)
		if m.Widget.AccountSelector != nil {
			capabilities = append(capabilities, CapabilityAccountSelector)
		}
	}
	if m.Window != nil {
		capabilities = append(capabilities, CapabilityWindow)
	}
	capabilities = append(capabilities, m.formatTwoCapabilities()...)
	sort.Strings(capabilities)
	return capabilities
}

// Diff 列出从 previous 到 current 的权限变化，评审时重点关注。
func Diff(previous, current Summary) []string {
	var changes []string
	before := toSet(previous.GatewayAPI)
	for _, scope := range current.GatewayAPI {
		if !before[scope] {
			changes = append(changes, "新增网关接口前缀 "+scope)
		}
	}
	after := toSet(current.GatewayAPI)
	for _, scope := range previous.GatewayAPI {
		if !after[scope] {
			changes = append(changes, "移除网关接口前缀 "+scope)
		}
	}
	old := map[string]ProxySummary{}
	for _, proxy := range previous.Proxies {
		old[proxy.Key] = proxy
	}
	for _, proxy := range current.Proxies {
		prior, found := old[proxy.Key]
		if !found {
			changes = append(changes, fmt.Sprintf("新增代理 %s → %s（%s）", proxy.Key, proxy.Upstream, strings.Join(proxy.Methods, ", ")))
			continue
		}
		delete(old, proxy.Key)
		if prior.Upstream != proxy.Upstream {
			changes = append(changes, fmt.Sprintf("代理 %s 的上游从 %s 改为 %s", proxy.Key, prior.Upstream, proxy.Upstream))
		}
		if added := missing(proxy.Methods, prior.Methods); len(added) > 0 {
			changes = append(changes, fmt.Sprintf("代理 %s 新增方法 %s", proxy.Key, strings.Join(added, ", ")))
		}
		if added := missing(proxy.Paths, prior.Paths); len(added) > 0 {
			changes = append(changes, fmt.Sprintf("代理 %s 新增路径 %s", proxy.Key, strings.Join(added, ", ")))
		}
		if proxy.PassQuery && !prior.PassQuery {
			changes = append(changes, fmt.Sprintf("代理 %s 开始转发查询参数", proxy.Key))
		}
		if proxy.BaseURLEditable != prior.BaseURLEditable {
			changes = append(changes, fmt.Sprintf("代理 %s 的上游地址可编辑性改为 %t", proxy.Key, proxy.BaseURLEditable))
		}
	}
	keys := make([]string, 0, len(old))
	for key := range old {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		changes = append(changes, "移除代理 "+key)
	}
	if current.Entry != previous.Entry {
		changes = append(changes, "页面来源从 "+previous.Entry+" 改为 "+current.Entry)
	}
	if current.DesktopWidget != previous.DesktopWidget {
		changes = append(changes, fmt.Sprintf("桌面卡片改为 %t", current.DesktopWidget))
	}
	return append(changes, diffFormatTwo(previous, current)...)
}

// Markdown 把摘要渲染成评审用的 Markdown。
func (s Summary) Markdown() string {
	var out strings.Builder
	switch s.Entry {
	case "gateway_page":
		out.WriteString("- 页面来源：网关代理的上游页面（gateway_page）\n")
	case "none":
		out.WriteString("- 没有窗口界面\n")
	default:
		out.WriteString("- 页面来源：包内静态页面（entry）\n")
	}
	if len(s.GatewayAPI) == 0 {
		out.WriteString("- 网关接口：不调用\n")
	} else {
		out.WriteString("- 网关接口（以当前用户身份调用）：`" + strings.Join(s.GatewayAPI, "`、`") + "`\n")
	}
	if len(s.Proxies) == 0 {
		out.WriteString("- 代理：无\n")
	}
	for _, proxy := range s.Proxies {
		credential := "无需凭据"
		if proxy.NeedsCredential {
			credential = "需要凭据（" + proxy.AuthType + "）"
		}
		editable := ""
		if proxy.BaseURLEditable {
			editable = "，安装时可修改地址"
		}
		fmt.Fprintf(&out, "- 代理 `%s`（%s）：%s，%s，路径 `%s`，%s%s\n", proxy.Key, proxy.Title, proxy.Upstream,
			strings.Join(proxy.Methods, "/"), strings.Join(proxy.Paths, "`、`"), credential, editable)
	}
	if s.DesktopWidget {
		out.WriteString("- 提供桌面卡片\n")
	}
	s.markdownFormatTwo(&out)
	return out.String()
}

func toSet(values []string) map[string]bool {
	set := make(map[string]bool, len(values))
	for _, value := range values {
		set[value] = true
	}
	return set
}

func missing(values, reference []string) []string {
	known := toSet(reference)
	var result []string
	for _, value := range values {
		if !known[value] {
			result = append(result, value)
		}
	}
	return result
}

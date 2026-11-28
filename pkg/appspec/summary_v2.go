package appspec

import (
	"fmt"
	"sort"
	"strings"
)

// 格式 2 的组件、能力标记与扩展权限摘要，合同见 docs/spec/01-package-v2.md 第 10 节与 docs/spec/03-catalog.md 第 4 节。

// AccessSummary 是应用内权限与默认授予。
type AccessSummary struct {
	Permissions  []AccessPermissionSummary `json:"permissions"`
	DefaultGrant string                    `json:"defaultGrant"`
}

// AccessPermissionSummary 是一个应用内权限。
type AccessPermissionSummary struct {
	Name  string `json:"name"`
	Title string `json:"title"`
}

// SurfacesSummary 是界面入口。
type SurfacesSummary struct {
	Standalone bool           `json:"standalone"`
	Public     *PublicSummary `json:"public,omitempty"`
}

// PublicSummary 是公开入口。
type PublicSummary struct {
	Alias   string `json:"alias,omitempty"`
	Session string `json:"session"`
}

// BackendSummary 是后端声明的可达范围。
type BackendSummary struct {
	Routes    []RouteSummary  `json:"routes"`
	Storage   StorageSummary  `json:"storage"`
	HTTP      []string        `json:"http"`
	Hooks     []string        `json:"hooks"`
	Schedules []string        `json:"schedules"`
	Config    []ConfigSummary `json:"config"`
}

// RouteAuditSummary 是一条后端路由的审计日志声明摘要。
type RouteAuditSummary struct {
	Mode   string `json:"mode,omitempty"`
	Action string `json:"action,omitempty"`
	Label  string `json:"label,omitempty"`
}

// RouteSummary 是一条后端路由。
type RouteSummary struct {
	Path       string             `json:"path"`
	Methods    []string           `json:"methods"`
	Visibility string             `json:"visibility"`
	Audit      *RouteAuditSummary `json:"audit,omitempty"`
}

// StorageSummary 是启用的存储范围。
type StorageSummary struct {
	Shared  bool `json:"shared"`
	Public  bool `json:"public"`
	Account bool `json:"account"`
}

// ConfigSummary 是安装配置项。
type ConfigSummary struct {
	Key    string `json:"key"`
	Title  string `json:"title"`
	Secret bool   `json:"secret"`
}

// PlatformSummary 是使用的平台能力与提供的扩展点。
type PlatformSummary struct {
	Uses     []string `json:"uses"`
	Provides []string `json:"provides"`
}

// MCPSummary 是 AI 组件。
type MCPSummary struct {
	Tools     []ToolSummary     `json:"tools"`
	Resources []ResourceSummary `json:"resources"`
	Prompts   []PromptSummary   `json:"prompts"`
	Remote    *RemoteSummary    `json:"remote,omitempty"`
}

// ToolSummary 是一个工具。
type ToolSummary struct {
	Name        string `json:"name"`
	Title       string `json:"title"`
	Description string `json:"description"`
	ReadOnly    bool   `json:"readOnly"`
	Destructive bool   `json:"destructive"`
	Kind        string `json:"kind"`
}

// ResourceSummary 是一个资源。
type ResourceSummary struct {
	URI   string `json:"uri"`
	Title string `json:"title"`
}

// PromptSummary 是一个提示模板。
type PromptSummary struct {
	Name  string `json:"name"`
	Title string `json:"title"`
}

// RemoteSummary 是远程 MCP 服务。
type RemoteSummary struct {
	Proxy       string   `json:"proxy"`
	PinnedTools []string `json:"pinnedTools"`
}

// Components 返回应用包含的组件（ui、backend、mcp、skills 顺序）。
func (m Manifest) Components() []string {
	components := []string{}
	if m.HasUI() {
		components = append(components, "ui")
	}
	if m.Backend != nil {
		components = append(components, "backend")
	}
	if m.MCP != nil {
		components = append(components, "mcp")
	}
	if len(m.Skills) > 0 {
		components = append(components, "skills")
	}
	return components
}

// formatTwoCapabilities 返回格式 2 新增的能力标记。
func (m Manifest) formatTwoCapabilities() []string {
	if m.Format != 2 {
		return nil
	}
	marks := []string{"format.2", fmt.Sprintf("platform.%d", m.RequiredPlatform())}
	if b := m.Backend; b != nil {
		marks = append(marks, fmt.Sprintf("backend.%s.abi%d", b.Runtime, b.ABI))
		for _, scope := range b.StorageScopes() {
			marks = append(marks, "storage."+scope)
		}
		if len(b.TokenScopes) > 0 {
			marks = append(marks, "backend.token_scopes")
		}
	}
	if a := m.Access; a != nil {
		if len(a.Permissions) > 0 {
			marks = append(marks, "access.permissions")
		}
		if a.DefaultGrant != "" && a.DefaultGrant != "none" {
			marks = append(marks, "access.default_grant")
		}
	}
	if s := m.Surfaces; s != nil {
		if s.Standalone != nil && s.Standalone.Enabled {
			marks = append(marks, "surface.standalone")
		}
		if s.Public != nil {
			marks = append(marks, "surface.public")
			if s.Public.Session == "optional" {
				marks = append(marks, "surface.public.session")
			}
		}
	}
	if p := m.Platform; p != nil {
		for _, name := range p.Uses {
			marks = append(marks, "uses."+name)
		}
		for name := range p.Provides {
			marks = append(marks, "provides."+name)
		}
	}
	if mcp := m.MCP; mcp != nil {
		declarative := false
		for _, tool := range mcp.Tools {
			declarative = declarative || tool.Call.Kind() == "declarative"
		}
		for _, resource := range mcp.Resources {
			declarative = declarative || resource.Call.Kind() == "declarative"
		}
		if len(mcp.Tools) > 0 {
			marks = append(marks, "mcp.tools")
		}
		if declarative {
			marks = append(marks, "mcp.declarative")
		}
		if mcp.Remote != nil {
			marks = append(marks, "mcp.remote")
		}
		if len(mcp.Resources) > 0 {
			marks = append(marks, "mcp.resources")
		}
		if len(mcp.Prompts) > 0 {
			marks = append(marks, "mcp.prompts")
		}
	}
	if len(m.Skills) > 0 {
		marks = append(marks, "skills")
	}
	return marks
}

// summarizeFormatTwo 填充摘要中的格式 2 部分。
func (m Manifest) summarizeFormatTwo(summary *Summary) {
	if a := m.Access; a != nil {
		access := &AccessSummary{Permissions: []AccessPermissionSummary{}, DefaultGrant: a.DefaultGrant}
		if access.DefaultGrant == "" {
			access.DefaultGrant = "none"
		}
		for _, permission := range a.Permissions {
			access.Permissions = append(access.Permissions, AccessPermissionSummary{Name: permission.Name, Title: permission.Title})
		}
		summary.Access = access
	}
	if s := m.Surfaces; s != nil {
		surfaces := &SurfacesSummary{Standalone: s.Standalone != nil && s.Standalone.Enabled}
		if s.Public != nil {
			session := s.Public.Session
			if session == "" {
				session = "none"
			}
			surfaces.Public = &PublicSummary{Alias: s.Public.Alias, Session: session}
		}
		summary.Surfaces = surfaces
	}
	if b := m.Backend; b != nil {
		backend := &BackendSummary{Routes: []RouteSummary{}, HTTP: []string{}, Hooks: []string{}, Schedules: []string{}, Config: []ConfigSummary{}}
		for _, route := range b.Routes {
			item := RouteSummary{Path: route.Path, Methods: append([]string{}, route.Methods...), Visibility: route.Visibility}
			if route.Audit != nil {
				item.Audit = &RouteAuditSummary{Mode: route.Audit.Mode, Action: route.Audit.Action, Label: route.Audit.Label}
			}
			backend.Routes = append(backend.Routes, item)
		}
		if b.Storage != nil {
			backend.Storage = StorageSummary{Shared: b.Storage.Shared, Public: b.Storage.Public, Account: b.Storage.Account}
		}
		if b.HTTP != nil {
			for _, allow := range b.HTTP.Allow {
				backend.HTTP = append(backend.HTTP, allow.Host)
			}
		}
		for _, hook := range b.Hooks {
			backend.Hooks = append(backend.Hooks, hook.Name)
		}
		for _, schedule := range b.Schedules {
			backend.Schedules = append(backend.Schedules, schedule.Name)
		}
		for _, item := range b.Config {
			backend.Config = append(backend.Config, ConfigSummary{Key: item.Key, Title: item.Title, Secret: item.Secret})
		}
		summary.Backend = backend
	}
	if p := m.Platform; p != nil {
		platform := &PlatformSummary{Uses: append([]string{}, p.Uses...), Provides: []string{}}
		for name := range p.Provides {
			platform.Provides = append(platform.Provides, name)
		}
		sort.Strings(platform.Uses)
		sort.Strings(platform.Provides)
		summary.Platform = platform
	}
	if mcp := m.MCP; mcp != nil {
		ai := &MCPSummary{Tools: []ToolSummary{}, Resources: []ResourceSummary{}, Prompts: []PromptSummary{}}
		for _, tool := range mcp.Tools {
			item := ToolSummary{Name: tool.Name, Title: tool.Title, Description: tool.Description, Kind: tool.Call.Kind()}
			if tool.Annotations != nil {
				item.ReadOnly, item.Destructive = tool.Annotations.ReadOnly, tool.Annotations.Destructive
			}
			ai.Tools = append(ai.Tools, item)
		}
		for _, resource := range mcp.Resources {
			ai.Resources = append(ai.Resources, ResourceSummary{URI: resource.URI, Title: resource.Title})
		}
		for _, prompt := range mcp.Prompts {
			ai.Prompts = append(ai.Prompts, PromptSummary{Name: prompt.Name, Title: prompt.Title})
		}
		if mcp.Remote != nil {
			ai.Remote = &RemoteSummary{Proxy: mcp.Remote.Proxy, PinnedTools: append([]string{}, mcp.Remote.PinnedTools...)}
		}
		summary.MCP = ai
	}
	if len(m.skillInfo) > 0 {
		summary.Skills = m.SkillInfos()
	}
}

// diffFormatTwo 列出格式 2 部分新增或扩大的范围。
func diffFormatTwo(previous, current Summary) []string {
	var changes []string
	if a := current.Access; a != nil {
		before := map[string]bool{}
		priorGrant := "none"
		if previous.Access != nil {
			for _, permission := range previous.Access.Permissions {
				before[permission.Name] = true
			}
			priorGrant = previous.Access.DefaultGrant
		}
		for _, permission := range a.Permissions {
			if !before[permission.Name] {
				changes = append(changes, fmt.Sprintf("新增应用内权限 %s（%s）", permission.Name, permission.Title))
			}
		}
		if a.DefaultGrant != priorGrant {
			changes = append(changes, "默认授予从 "+priorGrant+" 改为 "+a.DefaultGrant)
		}
	}
	if s := current.Surfaces; s != nil {
		prior := previous.Surfaces
		if s.Standalone && (prior == nil || !prior.Standalone) {
			changes = append(changes, "开启独立页面入口")
		}
		if s.Public != nil {
			switch {
			case prior == nil || prior.Public == nil:
				changes = append(changes, "新增公开页面（未登录可访问）")
			case prior.Public.Alias != s.Public.Alias:
				changes = append(changes, "公开页面路径别名改为 "+s.Public.Alias)
			}
			if s.Public.Session == "optional" && (prior == nil || prior.Public == nil || prior.Public.Session != "optional") {
				changes = append(changes, "公开页面开始读取登录状态")
			}
		}
	}
	if b := current.Backend; b != nil {
		prior := previous.Backend
		if prior == nil {
			changes = append(changes, "新增后端模块")
			prior = &BackendSummary{}
		}
		routes := map[string]string{}
		for _, route := range prior.Routes {
			for _, method := range route.Methods {
				routes[method+" "+route.Path] = route.Visibility
			}
		}
		for _, route := range b.Routes {
			for _, method := range route.Methods {
				key := method + " " + route.Path
				visibility, found := routes[key]
				switch {
				case !found:
					changes = append(changes, fmt.Sprintf("新增后端路由 %s（%s）", key, route.Visibility))
				case visibility != route.Visibility:
					changes = append(changes, fmt.Sprintf("后端路由 %s 的可见范围从 %s 改为 %s", key, visibility, route.Visibility))
				}
			}
		}
		for _, scope := range []struct {
			name          string
			before, after bool
		}{
			{"shared", prior.Storage.Shared, b.Storage.Shared}, {"public", prior.Storage.Public, b.Storage.Public},
			{"account", prior.Storage.Account, b.Storage.Account},
		} {
			if scope.after && !scope.before {
				changes = append(changes, "启用存储范围 "+scope.name)
			}
		}
		for _, host := range missing(b.HTTP, prior.HTTP) {
			changes = append(changes, "新增可访问的外部主机 "+host)
		}
		for _, hook := range missing(b.Hooks, prior.Hooks) {
			changes = append(changes, "新增公开回调 "+hook)
		}
		for _, schedule := range missing(b.Schedules, prior.Schedules) {
			changes = append(changes, "新增定时任务 "+schedule)
		}
		configs := map[string]bool{}
		for _, item := range prior.Config {
			configs[item.Key] = true
		}
		for _, item := range b.Config {
			if !configs[item.Key] {
				changes = append(changes, "新增安装配置项 "+item.Key)
			}
		}
	}
	if p := current.Platform; p != nil {
		prior := &PlatformSummary{}
		if previous.Platform != nil {
			prior = previous.Platform
		}
		for _, name := range missing(p.Uses, prior.Uses) {
			changes = append(changes, "新增平台能力 "+name)
		}
		for _, name := range missing(p.Provides, prior.Provides) {
			changes = append(changes, "新增扩展点 "+name)
		}
	}
	if ai := current.MCP; ai != nil {
		tools := map[string]ToolSummary{}
		if previous.MCP != nil {
			for _, tool := range previous.MCP.Tools {
				tools[tool.Name] = tool
			}
		}
		for _, tool := range ai.Tools {
			prior, found := tools[tool.Name]
			mark := ""
			if tool.Destructive {
				mark = "，有副作用"
			}
			switch {
			case !found:
				changes = append(changes, fmt.Sprintf("新增 AI 工具 %s（%s%s）", tool.Name, tool.Kind, mark))
			case tool.Destructive && !prior.Destructive:
				changes = append(changes, "AI 工具 "+tool.Name+" 改为有副作用")
			case tool.Kind != prior.Kind:
				changes = append(changes, fmt.Sprintf("AI 工具 %s 的执行方式从 %s 改为 %s", tool.Name, prior.Kind, tool.Kind))
			}
		}
		if ai.Remote != nil && (previous.MCP == nil || previous.MCP.Remote == nil) {
			changes = append(changes, "接入远程 MCP 服务（代理 "+ai.Remote.Proxy+"）")
		}
	}
	skills := map[string]bool{}
	for _, skill := range previous.Skills {
		skills[skill.Name] = true
	}
	for _, skill := range current.Skills {
		if !skills[skill.Name] {
			changes = append(changes, "新增技能 "+skill.Name)
		}
	}
	return changes
}

// markdownFormatTwo 渲染摘要中的格式 2 部分。
func (s Summary) markdownFormatTwo(out *strings.Builder) {
	if a := s.Access; a != nil {
		names := make([]string, 0, len(a.Permissions))
		for _, permission := range a.Permissions {
			names = append(names, fmt.Sprintf("`%s`（%s）", permission.Name, permission.Title))
		}
		if len(names) > 0 {
			out.WriteString("- 应用内权限：" + strings.Join(names, "、") + "\n")
		}
		if a.DefaultGrant != "none" {
			out.WriteString("- 默认授予：" + a.DefaultGrant + "\n")
		}
	}
	if surfaces := s.Surfaces; surfaces != nil {
		if surfaces.Standalone {
			out.WriteString("- 可在浏览器新标签页独立打开\n")
		}
		if public := surfaces.Public; public != nil {
			line := "- **公开页面（未登录可访问）**"
			if public.Alias != "" {
				line += "，建议路径 `" + public.Alias + "`"
			}
			if public.Session == "optional" {
				line += "，已登录时读取登录状态"
			}
			out.WriteString(line + "\n")
		}
	}
	if b := s.Backend; b != nil {
		out.WriteString("- 后端模块：\n")
		for _, route := range b.Routes {
			fmt.Fprintf(out, "  - 路由 `%s %s`（%s）\n", strings.Join(route.Methods, "/"), route.Path, route.Visibility)
		}
		var scopes []string
		for scope, enabled := range map[string]bool{"shared": b.Storage.Shared, "public": b.Storage.Public, "account": b.Storage.Account} {
			if enabled {
				scopes = append(scopes, scope)
			}
		}
		sort.Strings(scopes)
		if len(scopes) > 0 {
			out.WriteString("  - 存储范围：" + strings.Join(scopes, "、") + "\n")
		}
		if len(b.HTTP) > 0 {
			out.WriteString("  - 可访问的外部主机：`" + strings.Join(b.HTTP, "`、`") + "`\n")
		}
		if len(b.Hooks) > 0 {
			out.WriteString("  - 公开回调：" + strings.Join(b.Hooks, "、") + "\n")
		}
		if len(b.Schedules) > 0 {
			out.WriteString("  - 定时任务：" + strings.Join(b.Schedules, "、") + "\n")
		}
		for _, item := range b.Config {
			secret := ""
			if item.Secret {
				secret = "（加密保存）"
			}
			fmt.Fprintf(out, "  - 安装时需要填写：%s%s\n", item.Title, secret)
		}
	}
	if p := s.Platform; p != nil {
		if len(p.Uses) > 0 {
			out.WriteString("- 平台能力：" + strings.Join(p.Uses, "、") + "\n")
		}
		if len(p.Provides) > 0 {
			out.WriteString("- 扩展点：" + strings.Join(p.Provides, "、") + "\n")
		}
	}
	if ai := s.MCP; ai != nil {
		for _, tool := range ai.Tools {
			mark := ""
			switch {
			case tool.Destructive:
				mark = "，**有副作用**"
			case tool.ReadOnly:
				mark = "，只读"
			}
			fmt.Fprintf(out, "- AI 工具 `%s`（%s，%s%s）：%s\n", tool.Name, tool.Title, tool.Kind, mark, tool.Description)
		}
		if len(ai.Resources) > 0 {
			out.WriteString(fmt.Sprintf("- AI 资源：%d 个\n", len(ai.Resources)))
		}
		if len(ai.Prompts) > 0 {
			out.WriteString(fmt.Sprintf("- 提示模板：%d 个\n", len(ai.Prompts)))
		}
		if ai.Remote != nil {
			out.WriteString("- 远程 MCP 服务（代理 `" + ai.Remote.Proxy + "`），固定工具：" + strings.Join(ai.Remote.PinnedTools, "、") + "\n")
		}
	}
	for _, skill := range s.Skills {
		fmt.Fprintf(out, "- 技能 `%s`：%s\n", skill.Name, skill.Description)
	}
}

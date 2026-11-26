package appspec

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
)

// 格式 2 的 AI 组件：工具、资源、提示模板与远程 MCP，合同见 docs/spec/01-package-v2.md 第 8 节。

var (
	toolNamePattern    = regexp.MustCompile(`^[a-z][a-z0-9_]{1,47}$`)
	placeholderPattern = regexp.MustCompile(`\{([A-Za-z_][A-Za-z0-9_]*)\}`)
	resourceURIPattern = regexp.MustCompile(`^[a-z][a-z0-9+.-]*://[^\s]{1,200}$`)
)

// MCP 是供 AI 调用的工具、资源与提示模板。
type MCP struct {
	Tools     []Tool     `json:"tools,omitempty"`
	Resources []Resource `json:"resources,omitempty"`
	Prompts   []Prompt   `json:"prompts,omitempty"`
	Remote    *RemoteMCP `json:"remote,omitempty"`
}

// Tool 是一个 AI 工具。
type Tool struct {
	Name        string           `json:"name"`
	Title       string           `json:"title"`
	Description string           `json:"description"`
	InputSchema json.RawMessage  `json:"input_schema"`
	Annotations *ToolAnnotations `json:"annotations,omitempty"`
	Call        ToolCall         `json:"call"`
}

// ToolAnnotations 标记工具是否只读、是否有副作用。
type ToolAnnotations struct {
	ReadOnly    bool `json:"read_only,omitempty"`
	Destructive bool `json:"destructive,omitempty"`
}

// ToolCall 指定工具如何执行：后端路由、声明式代理请求或远程 MCP，三选一。
type ToolCall struct {
	Backend string            `json:"backend,omitempty"`
	Proxy   string            `json:"proxy,omitempty"`
	Method  string            `json:"method,omitempty"`
	Path    string            `json:"path,omitempty"`
	Query   map[string]string `json:"query,omitempty"`
	Body    json.RawMessage   `json:"body,omitempty"`
	Remote  bool              `json:"remote,omitempty"`
}

// Kind 返回 backend、declarative 或 remote。
func (c ToolCall) Kind() string {
	switch {
	case c.Backend != "":
		return "backend"
	case c.Remote:
		return "remote"
	default:
		return "declarative"
	}
}

// Resource 是只读资源。
type Resource struct {
	URI   string   `json:"uri"`
	Title string   `json:"title"`
	Call  ToolCall `json:"call"`
}

// Prompt 是提示模板。
type Prompt struct {
	Name  string `json:"name"`
	Title string `json:"title"`
	File  string `json:"file"`
}

// RemoteMCP 接入独立部署的 MCP 服务。
type RemoteMCP struct {
	Proxy       string   `json:"proxy"`
	Path        string   `json:"path"`
	PinnedTools []string `json:"pinned_tools"`
}

// 允许出现在 input_schema 中的关键字（JSON Schema 子集）。
var schemaKeywords = map[string]bool{
	"type": true, "properties": true, "required": true, "enum": true, "items": true, "minimum": true,
	"maximum": true, "minLength": true, "maxLength": true, "description": true,
}

var schemaTypes = map[string]bool{"object": true, "string": true, "number": true, "integer": true, "boolean": true, "array": true}

func (m *Manifest) validateMCP(files []File) error {
	mcp := m.MCP
	if mcp == nil {
		return nil
	}
	if len(mcp.Tools) == 0 && len(mcp.Resources) == 0 && len(mcp.Prompts) == 0 {
		return errors.New("mcp 至少要声明一个工具、资源或提示模板")
	}
	if len(mcp.Tools) > 64 || len(mcp.Resources) > 32 || len(mcp.Prompts) > 32 {
		return errors.New("mcp 的工具（上限 64）、资源或提示模板（上限 32）过多")
	}
	if err := m.validateRemoteMCP(); err != nil {
		return err
	}
	pinned := map[string]bool{}
	if mcp.Remote != nil {
		for _, name := range mcp.Remote.PinnedTools {
			pinned[name] = true
		}
	}
	names := map[string]bool{}
	for i := range mcp.Tools {
		tool := &mcp.Tools[i]
		if !toolNamePattern.MatchString(tool.Name) || names[tool.Name] {
			return fmt.Errorf("mcp.tools 第 %d 项的 name %q 无效或重复", i+1, tool.Name)
		}
		names[tool.Name] = true
		if strings.TrimSpace(tool.Title) == "" || len([]rune(tool.Title)) > 64 {
			return fmt.Errorf("工具 %q 的 title 必须是 1-64 个字符", tool.Name)
		}
		if strings.TrimSpace(tool.Description) == "" || len([]rune(tool.Description)) > 500 {
			return fmt.Errorf("工具 %q 的 description 必须是 1-500 个字符", tool.Name)
		}
		if tool.Annotations != nil && tool.Annotations.ReadOnly && tool.Annotations.Destructive {
			return fmt.Errorf("工具 %q 不能同时是 read_only 与 destructive", tool.Name)
		}
		properties, err := checkInputSchema(tool.InputSchema)
		if err != nil {
			return fmt.Errorf("工具 %q 的 input_schema：%w", tool.Name, err)
		}
		if tool.Call.Remote && !pinned[tool.Name] {
			return fmt.Errorf("远程工具 %q 必须列在 mcp.remote.pinned_tools 中", tool.Name)
		}
		if err := m.checkToolCall(tool.Call, properties, true); err != nil {
			return fmt.Errorf("工具 %q 的 call：%w", tool.Name, err)
		}
	}
	uris := map[string]bool{}
	for i, resource := range mcp.Resources {
		if !resourceURIPattern.MatchString(resource.URI) || uris[resource.URI] {
			return fmt.Errorf("mcp.resources 第 %d 项的 uri 无效或重复", i+1)
		}
		uris[resource.URI] = true
		if strings.TrimSpace(resource.Title) == "" || len([]rune(resource.Title)) > 64 {
			return fmt.Errorf("资源 %q 的 title 必须是 1-64 个字符", resource.URI)
		}
		if err := m.checkToolCall(resource.Call, map[string]bool{}, false); err != nil {
			return fmt.Errorf("资源 %q 的 call：%w", resource.URI, err)
		}
	}
	prompts := map[string]bool{}
	for i, prompt := range mcp.Prompts {
		if !toolNamePattern.MatchString(prompt.Name) || prompts[prompt.Name] {
			return fmt.Errorf("mcp.prompts 第 %d 项的 name 无效或重复", i+1)
		}
		prompts[prompt.Name] = true
		if strings.TrimSpace(prompt.Title) == "" || len([]rune(prompt.Title)) > 64 {
			return fmt.Errorf("提示模板 %q 的 title 必须是 1-64 个字符", prompt.Name)
		}
		if !strings.HasPrefix(prompt.File, "mcp/prompts/") || !strings.HasSuffix(prompt.File, ".md") {
			return fmt.Errorf("提示模板 %q 的 file 必须是 mcp/prompts/ 下的 .md 文件", prompt.Name)
		}
		file, found := fileByPath(files, prompt.File)
		if !found {
			return fmt.Errorf("提示模板 %q 的文件 %s 在安装包中不存在", prompt.Name, prompt.File)
		}
		if len(file.Content) > 16<<10 {
			return fmt.Errorf("提示模板 %q 超过 16 KB", prompt.Name)
		}
	}
	return nil
}

func (m *Manifest) validateRemoteMCP() error {
	remote := m.MCP.Remote
	if remote == nil {
		return nil
	}
	proxy, found := m.proxy(remote.Proxy)
	if !found || !m.hasPermission(remote.Proxy) {
		return errors.New("mcp.remote.proxy 必须是已声明且有 proxy 权限点的代理")
	}
	clean, err := normalizeAllowedPath(remote.Path)
	if err != nil {
		return fmt.Errorf("mcp.remote.path：%w", err)
	}
	if !proxy.allowsPath(clean) || !proxy.allowsMethod(http.MethodPost) {
		return errors.New("mcp.remote.path 必须在代理路径白名单内，且代理须允许 POST")
	}
	remote.Path = clean
	if len(remote.PinnedTools) == 0 || len(remote.PinnedTools) > 64 {
		return errors.New("mcp.remote.pinned_tools 必须列出 1-64 个工具名")
	}
	seen := map[string]bool{}
	for _, name := range remote.PinnedTools {
		if !toolNamePattern.MatchString(name) || seen[name] {
			return fmt.Errorf("mcp.remote.pinned_tools 中的 %q 无效或重复", name)
		}
		seen[name] = true
	}
	return nil
}

// checkToolCall 校验执行方式；properties 是参数名集合，用于检查声明式请求中的占位符。
func (m *Manifest) checkToolCall(call ToolCall, properties map[string]bool, allowRemote bool) error {
	kinds := 0
	if call.Backend != "" {
		kinds++
	}
	if call.Proxy != "" {
		kinds++
	}
	if call.Remote {
		kinds++
	}
	if kinds != 1 {
		return errors.New("backend、proxy、remote 必须且只能指定一种")
	}
	switch call.Kind() {
	case "backend":
		if call.Method != "" || call.Path != "" || call.Query != nil || call.Body != nil {
			return errors.New("后端工具只能写 backend 路由")
		}
		if !m.Backend.hasRoute(call.Backend, http.MethodPost) {
			return fmt.Errorf("路由 %q 没有在 backend.routes 中以 POST 声明", call.Backend)
		}
	case "remote":
		if !allowRemote {
			return errors.New("这里不支持 remote")
		}
		if call.Method != "" || call.Path != "" || call.Query != nil || call.Body != nil {
			return errors.New("远程工具不能写请求参数")
		}
	default:
		return m.checkDeclarativeCall(call, properties)
	}
	return nil
}

func (m *Manifest) checkDeclarativeCall(call ToolCall, properties map[string]bool) error {
	proxy, found := m.proxy(call.Proxy)
	if !found || !m.hasPermission(call.Proxy) {
		return fmt.Errorf("代理 %q 没有声明或缺少 proxy 权限点", call.Proxy)
	}
	method := call.Method
	if method == "" {
		method = http.MethodGet
	}
	if !proxy.allowsMethod(method) {
		return fmt.Errorf("代理 %q 不允许方法 %s", call.Proxy, method)
	}
	if strings.Contains(call.Path, "{") {
		return errors.New("path 不能包含参数占位符，参数放在 query 或 body 中")
	}
	clean, err := normalizeAllowedPath(call.Path)
	if err != nil || !proxy.allowsPath(clean) {
		return fmt.Errorf("path %q 不在代理 %q 的路径白名单内", call.Path, call.Proxy)
	}
	if len(call.Query) > 0 && !proxy.PassQuery {
		return fmt.Errorf("代理 %q 没有开启 pass_query，不能带查询参数", call.Proxy)
	}
	for key, value := range call.Query {
		if !widgetQueryPattern.MatchString(key) {
			return fmt.Errorf("查询参数名 %q 无效", key)
		}
		if err := checkPlaceholders(value, properties); err != nil {
			return err
		}
	}
	if len(call.Body) > 0 {
		if method == http.MethodGet || method == http.MethodHead {
			return errors.New("GET / HEAD 请求不能带 body")
		}
		if len(call.Body) > 8<<10 || !json.Valid(call.Body) {
			return errors.New("body 必须是不超过 8 KB 的 JSON")
		}
		if err := checkPlaceholders(string(call.Body), properties); err != nil {
			return err
		}
	}
	return nil
}

func checkPlaceholders(value string, properties map[string]bool) error {
	for _, match := range placeholderPattern.FindAllStringSubmatch(value, -1) {
		if !properties[match[1]] {
			return fmt.Errorf("占位符 {%s} 没有对应的 input_schema 参数", match[1])
		}
	}
	return nil
}

// checkInputSchema 校验 JSON Schema 子集，返回顶层参数名。
func checkInputSchema(raw json.RawMessage) (map[string]bool, error) {
	if len(raw) == 0 {
		return nil, errors.New("缺少 input_schema")
	}
	if len(raw) > 8<<10 {
		return nil, errors.New("超过 8 KB")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var schema map[string]any
	if err := decoder.Decode(&schema); err != nil {
		return nil, errors.New("不是 JSON 对象")
	}
	if schema["type"] != "object" {
		return nil, errors.New("顶层 type 必须是 object")
	}
	if err := checkSchemaNode(schema, 0); err != nil {
		return nil, err
	}
	properties := map[string]bool{}
	if values, ok := schema["properties"].(map[string]any); ok {
		for name := range values {
			properties[name] = true
		}
	}
	return properties, nil
}

func checkSchemaNode(node map[string]any, depth int) error {
	if depth > 6 {
		return errors.New("嵌套过深（上限 6 层）")
	}
	for key, value := range node {
		if !schemaKeywords[key] {
			return fmt.Errorf("不支持关键字 %q", key)
		}
		switch key {
		case "type":
			name, ok := value.(string)
			if !ok || !schemaTypes[name] {
				return fmt.Errorf("type %v 无效", value)
			}
		case "properties":
			children, ok := value.(map[string]any)
			if !ok || len(children) > 32 {
				return errors.New("properties 必须是对象，且不超过 32 个属性")
			}
			for name, child := range children {
				if !widgetQueryPattern.MatchString(name) {
					return fmt.Errorf("属性名 %q 无效", name)
				}
				object, ok := child.(map[string]any)
				if !ok {
					return fmt.Errorf("属性 %q 必须是对象", name)
				}
				if err := checkSchemaNode(object, depth+1); err != nil {
					return fmt.Errorf("属性 %q：%w", name, err)
				}
			}
		case "items":
			object, ok := value.(map[string]any)
			if !ok {
				return errors.New("items 必须是对象")
			}
			if err := checkSchemaNode(object, depth+1); err != nil {
				return fmt.Errorf("items：%w", err)
			}
		case "required", "enum":
			list, ok := value.([]any)
			if !ok || len(list) > 64 {
				return fmt.Errorf("%s 必须是不超过 64 项的数组", key)
			}
		case "description":
			if text, ok := value.(string); !ok || len([]rune(text)) > 500 {
				return errors.New("description 必须是不超过 500 个字符的字符串")
			}
		default:
			if _, ok := value.(json.Number); !ok {
				return fmt.Errorf("%s 必须是数字", key)
			}
		}
	}
	return nil
}

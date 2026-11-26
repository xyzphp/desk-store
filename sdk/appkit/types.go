// Package appkit 提供应用包格式 2 后端模块（ABI 1）的 Go 开发套件：
// 路由与上下文、database/sql 驱动（appdb）、KV 存储、安装配置、日志、外部 HTTP、代理、系统接口、平台能力与迁移钩子。
// 编译目标为 wasip1/wasm（-buildmode=c-shared）时通过 //go:wasmimport 调用宿主函数；
// 在本机运行 go test 时自动切换到可替换的 HostAdapter，无需编译 Wasm 即可单元测试。
package appkit

import (
	"encoding/json"
	"fmt"
)

// ABI 1 宿主函数错误码，合同见 docs/spec/02-backend.md 第 3.3 节。
const (
	CodeOK       int32 = 0
	CodeErr      int32 = -1
	CodeDenied   int32 = -2
	CodeInvalid  int32 = -3
	CodeNotFound int32 = -4
	CodeLimit    int32 = -5
	CodeTimeout  int32 = -6
)

// 日志级别常量（对应 host.log 的 level 参数）。
const (
	LogLevelDebug uint32 = 0
	LogLevelInfo  uint32 = 1
	LogLevelWarn  uint32 = 2
	LogLevelError uint32 = 3
)

// HostError 表示宿主函数返回的负错误码与诊断说明。
type HostError struct {
	Op      string
	Code    int32
	Message string
}

func (e *HostError) Error() string {
	if e.Message != "" {
		return fmt.Sprintf("host.%s (%d): %s", e.Op, e.Code, e.Message)
	}
	return fmt.Sprintf("host.%s failed with code %d", e.Op, e.Code)
}

// IsCode 判断错误是否为指定宿主错误码。
func IsCode(err error, code int32) bool {
	if he, ok := err.(*HostError); ok {
		return he.Code == code
	}
	return false
}

// RequestEnvelope 是经 host.request_read 传入模块的请求信封。
type RequestEnvelope struct {
	Method  string            `json:"method"`
	Path    string            `json:"path"`
	Query   string            `json:"query,omitempty"`
	Headers map[string]string `json:"headers,omitempty"`
	BodyB64 string            `json:"body_b64,omitempty"`
	Context RequestContext    `json:"context"`
}

// RequestContext 由宿主填写，模块只读。
type RequestContext struct {
	AppSlug     string   `json:"app_slug"`
	Entry       string   `json:"entry"`
	User        *User    `json:"user,omitempty"`
	Permissions []string `json:"permissions"`
	Locale      string   `json:"locale"`
	Route       string   `json:"route"`
	Visibility  string   `json:"visibility"`
}

// User 是已认证调用者的最小身份信息。
type User struct {
	ID          int64  `json:"id"`
	DisplayName string `json:"display_name"`
}

// ResponseEnvelope 是模块经 host.response_write 写出的响应信封。
type ResponseEnvelope struct {
	Status   int               `json:"status"`
	Headers  map[string]string `json:"headers,omitempty"`
	BodyB64  string            `json:"body_b64,omitempty"`
	SendFile string            `json:"send_file,omitempty"`
}

// UploadInfo 是大文件直传路由收到请求体中的 upload 元数据。
type UploadInfo struct {
	Path      string `json:"path"`
	Scope     string `json:"scope"`
	Filename  string `json:"filename"`
	MediaType string `json:"media_type"`
	Size      int64  `json:"size"`
	SHA256    string `json:"sha256"`
}

// MigrateEvent 是 migrate() 生命周期钩子收到的版本信息。
type MigrateEvent struct {
	FromVersion string `json:"from_version"`
	ToVersion   string `json:"to_version"`
}

// ScheduleEvent 是定时任务触发时请求体中的载荷。
type ScheduleEvent struct {
	Schedule    string `json:"schedule"`
	TriggeredAt int64  `json:"triggered_at"`
}

// HTTPRequest 是 host.http_fetch 的请求参数。
type HTTPRequest struct {
	Method    string            `json:"method"`
	URL       string            `json:"url"`
	Headers   map[string]string `json:"headers,omitempty"`
	Body      []byte            `json:"-"`
	TimeoutMS int               `json:"timeout_ms,omitempty"`
}

// ProxyRequest 是 host.proxy_fetch 的请求参数。
type ProxyRequest struct {
	Proxy   string            `json:"proxy"`
	Method  string            `json:"method,omitempty"`
	Path    string            `json:"path"`
	Query   string            `json:"query,omitempty"`
	Headers map[string]string `json:"headers,omitempty"`
	Body    []byte            `json:"-"`
}

// APIRequest 是 host.api_call 的请求参数。
type APIRequest struct {
	Method  string            `json:"method,omitempty"`
	Path    string            `json:"path"`
	Query   string            `json:"query,omitempty"`
	Headers map[string]string `json:"headers,omitempty"`
	Body    []byte            `json:"-"`
}

// HTTPResponse 是 http_fetch / proxy_fetch / api_call 的统一响应。
type HTTPResponse struct {
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers,omitempty"`
	Body    []byte            `json:"-"`
}

// Identity 是 platform_call("identity.me") 返回的用户信息。
type Identity struct {
	ID          int64  `json:"id"`
	DisplayName string `json:"display_name"`
	AvatarURL   string `json:"avatar_url,omitempty"`
}

// KVItem 是 kv_call("list") 返回的单条记录。
type KVItem struct {
	Key       string          `json:"key"`
	Value     json.RawMessage `json:"value"`
	UpdatedAt int64           `json:"updated_at"`
}

package appkit

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"
)

// ---- 日志 ----

func Log(level uint32, format string, args ...any) {
	msg := format
	if len(args) > 0 {
		msg = fmt.Sprintf(format, args...)
	}
	_ = abiLog(level, []byte(msg))
}

func LogDebug(format string, args ...any) { Log(LogLevelDebug, format, args...) }
func LogInfo(format string, args ...any)  { Log(LogLevelInfo, format, args...) }
func LogWarn(format string, args ...any)  { Log(LogLevelWarn, format, args...) }
func LogError(format string, args ...any) { Log(LogLevelError, format, args...) }

// ---- 安装配置 ----

// Config 按键读取 manifest.backend.config 声明的配置值；未配置时返回 ("", false, nil)。
func Config(key string) (string, bool, error) {
	data, err := abiConfigGet([]byte(key))
	if err != nil {
		if IsCode(err, CodeNotFound) {
			return "", false, nil
		}
		return "", false, err
	}
	return string(data), true, nil
}

// ---- /data 文件路径辅助 ----

// DataPath 返回受限 /data 目录下的标准路径（scope 为 "shared"、"public" 或 "account"/"me"）。
func DataPath(scope, rel string) string {
	dir := scope
	if dir == "account" {
		dir = "me"
	}
	cleaned := strings.TrimPrefix(path.Clean("/"+rel), "/")
	if cleaned == "" || cleaned == "." {
		return "/data/" + dir
	}
	return "/data/" + dir + "/" + cleaned
}

// ---- 外部 HTTP、代理、系统 API 与平台能力 ----

type wireHTTPResp struct {
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers,omitempty"`
	BodyB64 string            `json:"body_b64,omitempty"`
}

func decodeWireHTTPResp(raw []byte) (HTTPResponse, error) {
	var wire wireHTTPResp
	if err := json.Unmarshal(raw, &wire); err != nil {
		return HTTPResponse{}, err
	}
	var body []byte
	if wire.BodyB64 != "" {
		decoded, err := base64.StdEncoding.DecodeString(wire.BodyB64)
		if err != nil {
			return HTTPResponse{}, err
		}
		body = decoded
	}
	return HTTPResponse{Status: wire.Status, Headers: wire.Headers, Body: body}, nil
}

// HTTPFetch 经宿主发出受 backend.http.allow 约束的外部 HTTP 请求。
func HTTPFetch(req HTTPRequest) (HTTPResponse, error) {
	wire := struct {
		Method    string            `json:"method"`
		URL       string            `json:"url"`
		Headers   map[string]string `json:"headers,omitempty"`
		BodyB64   string            `json:"body_b64,omitempty"`
		TimeoutMS int               `json:"timeout_ms,omitempty"`
	}{
		Method:    req.Method,
		URL:       req.URL,
		Headers:   req.Headers,
		TimeoutMS: req.TimeoutMS,
	}
	if len(req.Body) > 0 {
		wire.BodyB64 = base64.StdEncoding.EncodeToString(req.Body)
	}
	payload, err := json.Marshal(wire)
	if err != nil {
		return HTTPResponse{}, err
	}
	raw, err := abiHTTPFetch(payload)
	if err != nil {
		return HTTPResponse{}, err
	}
	return decodeWireHTTPResp(raw)
}

// NewHTTPClient 返回基于 host.http_fetch 的标准 *http.Client。
func NewHTTPClient() *http.Client {
	return &http.Client{Transport: httpFetchRoundTripper{}}
}

type httpFetchRoundTripper struct{}

func (httpFetchRoundTripper) RoundTrip(r *http.Request) (*http.Response, error) {
	var body []byte
	if r.Body != nil {
		var err error
		body, err = io.ReadAll(r.Body)
		_ = r.Body.Close()
		if err != nil {
			return nil, err
		}
	}
	headers := map[string]string{}
	for k, vals := range r.Header {
		if len(vals) > 0 {
			headers[strings.ToLower(k)] = vals[0]
		}
	}
	res, err := HTTPFetch(HTTPRequest{
		Method:  r.Method,
		URL:     r.URL.String(),
		Headers: headers,
		Body:    body,
	})
	if err != nil {
		return nil, err
	}
	hdr := make(http.Header, len(res.Headers))
	for k, v := range res.Headers {
		hdr.Set(k, v)
	}
	return &http.Response{
		StatusCode:    res.Status,
		Status:        fmt.Sprintf("%d %s", res.Status, http.StatusText(res.Status)),
		Header:        hdr,
		Body:          io.NopCloser(bytes.NewReader(res.Body)),
		ContentLength: int64(len(res.Body)),
		Request:       r,
	}, nil
}

// ProxyFetch 经宿主调用清单声明的 proxies 上游（凭据由宿主注入）。
func ProxyFetch(req ProxyRequest) (HTTPResponse, error) {
	wire := struct {
		Proxy   string            `json:"proxy"`
		Method  string            `json:"method,omitempty"`
		Path    string            `json:"path"`
		Query   string            `json:"query,omitempty"`
		Headers map[string]string `json:"headers,omitempty"`
		BodyB64 string            `json:"body_b64,omitempty"`
	}{
		Proxy:   req.Proxy,
		Method:  req.Method,
		Path:    req.Path,
		Query:   req.Query,
		Headers: req.Headers,
	}
	if len(req.Body) > 0 {
		wire.BodyB64 = base64.StdEncoding.EncodeToString(req.Body)
	}
	payload, err := json.Marshal(wire)
	if err != nil {
		return HTTPResponse{}, err
	}
	raw, err := abiProxyFetch(payload)
	if err != nil {
		return HTTPResponse{}, err
	}
	return decodeWireHTTPResp(raw)
}

// APICall 以当前已认证调用者身份调用清单 gateway_api 声明的目标系统接口。
func APICall(req APIRequest) (HTTPResponse, error) {
	wire := struct {
		Method  string            `json:"method,omitempty"`
		Path    string            `json:"path"`
		Query   string            `json:"query,omitempty"`
		Headers map[string]string `json:"headers,omitempty"`
		BodyB64 string            `json:"body_b64,omitempty"`
	}{
		Method:  req.Method,
		Path:    req.Path,
		Query:   req.Query,
		Headers: req.Headers,
	}
	if len(req.Body) > 0 {
		wire.BodyB64 = base64.StdEncoding.EncodeToString(req.Body)
	}
	payload, err := json.Marshal(wire)
	if err != nil {
		return HTTPResponse{}, err
	}
	raw, err := abiAPICall(payload)
	if err != nil {
		return HTTPResponse{}, err
	}
	return decodeWireHTTPResp(raw)
}

// PlatformCall 调用 host.platform_call 并将 JSON 结果解码到 dst（可为 nil）。
func PlatformCall(action string, params any, dst any) error {
	var rawParams json.RawMessage
	if params != nil {
		b, err := json.Marshal(params)
		if err != nil {
			return err
		}
		rawParams = b
	}
	payload, err := json.Marshal(struct {
		Action string          `json:"action"`
		Params json.RawMessage `json:"params,omitempty"`
	}{Action: action, Params: rawParams})
	if err != nil {
		return err
	}
	resp, err := abiPlatformCall(payload)
	if err != nil {
		return err
	}
	if dst == nil || len(resp) == 0 {
		return nil
	}
	return json.Unmarshal(resp, dst)
}

// SettingsGet 读取管理员维护的应用设置（需要 platform.provides.settings）。
func SettingsGet(dst any) (int64, error) {
	var out struct {
		Values    json.RawMessage `json:"values"`
		UpdatedAt int64           `json:"updated_at"`
	}
	if err := PlatformCall("settings.get", nil, &out); err != nil {
		return 0, err
	}
	if dst != nil && len(out.Values) > 0 {
		if err := json.Unmarshal(out.Values, dst); err != nil {
			return 0, err
		}
	}
	return out.UpdatedAt, nil
}

// IdentityMe 读取当前调用者身份（需要 platform.uses 包含 identity）。
func IdentityMe() (*Identity, error) {
	var out Identity
	if err := PlatformCall("identity.me", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// NotifySend 向指定已授权账号（或 userID == 0 时的当前调用者）发送站内通知（需要 platform.uses 包含 notify）。
func NotifySend(title, body string, userID int64) error {
	return PlatformCall("notify.send", map[string]any{
		"title":   title,
		"body":    body,
		"user_id": userID,
	}, nil)
}

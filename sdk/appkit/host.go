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

// SanitizedImage 是 platform_call("image.sanitize") 的返回元数据。
type SanitizedImage struct {
	Path      string `json:"path"`
	MediaType string `json:"media_type"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	Size      int    `json:"size"`
	SHA256    string `json:"sha256"`
}

// ImageSanitize 调用宿主清洗 PNG/JPEG 图片并写入应用隔离存储（/data/...），需要 platform.uses 包含 image.sanitize。
func ImageSanitize(sourcePath, destPath string, data []byte, format string, quality int) (SanitizedImage, error) {
	params := map[string]any{"dest_path": destPath}
	if sourcePath != "" {
		params["source_path"] = sourcePath
	}
	if len(data) > 0 {
		params["data_b64"] = base64.StdEncoding.EncodeToString(data)
	}
	if format != "" {
		params["format"] = format
	}
	if quality > 0 {
		params["quality"] = quality
	}
	var out SanitizedImage
	if err := PlatformCall("image.sanitize", params, &out); err != nil {
		return SanitizedImage{}, err
	}
	return out, nil
}

// FileReferenceAdd 登记应用对指定管理文件的引用，防止被误删（需要 platform.uses 包含 files.reference）。
func FileReferenceAdd(fileID, refKey string) error {
	return PlatformCall("files.reference.add", map[string]any{
		"file_id": fileID,
		"ref_key": refKey,
	}, nil)
}

// FileReferenceRemove 解除应用对指定管理文件的引用（refKey 为空时解除该文件的全部引用）。
func FileReferenceRemove(fileID, refKey string) error {
	return PlatformCall("files.reference.remove", map[string]any{
		"file_id": fileID,
		"ref_key": refKey,
	}, nil)
}

// ReferencedFile 是 platform_call("files.reference.read") 的返回：已被本应用登记引用的用户文件。
type ReferencedFile struct {
	FileID    string `json:"file_id"`
	Name      string `json:"name"`
	MediaType string `json:"media_type"`
	Size      int64  `json:"size"`
	Width     int    `json:"width,omitempty"`
	Height    int    `json:"height,omitempty"`
	UpdatedAt int64  `json:"updated_at,omitempty"`
	DataB64   string `json:"data_b64,omitempty"`
}

// FileReferenceRead 读取已被本应用登记引用的用户文件（任意入口可用，内容 ≤ 4 MB；metaOnly 只取元信息）。
// 更大的文件请用 Context.SendUserFile 由宿主直接流式发送。需要 platform.uses 包含 files.reference。
func FileReferenceRead(fileID string, metaOnly bool) (ReferencedFile, error) {
	params := map[string]any{"file_id": fileID}
	if metaOnly {
		params["meta_only"] = true
	}
	var out ReferencedFile
	if err := PlatformCall("files.reference.read", params, &out); err != nil {
		return ReferencedFile{}, err
	}
	return out, nil
}

// AIMessage 是 AIComplete 的一条对话消息，role 只能是 user 或 assistant，最后一条须为 user。
type AIMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// AICompleteOptions 是 AIComplete 的可选参数；ResponseFormat 为 "text"（默认）或 "json"。
type AICompleteOptions struct {
	System         string
	MaxOutput      int
	ResponseFormat string
}

// AICompletion 是 platform_call("ai.complete") 的返回。
type AICompletion struct {
	Text  string `json:"text"`
	Model string `json:"model"`
	Usage struct {
		InputTokens  int `json:"input_tokens"`
		OutputTokens int `json:"output_tokens"`
	} `json:"usage"`
}

// AIComplete 使用目标系统的默认文本模型补全文本（应用拿不到模型地址与密钥，按应用计量与每日限额）。
// 需要 platform.uses 包含 ai.complete；public 与 hook 入口不可用，单次执行受 backend.limits.timeout_ms 约束。
func AIComplete(messages []AIMessage, options AICompleteOptions) (AICompletion, error) {
	params := map[string]any{"messages": messages}
	if options.System != "" {
		params["system"] = options.System
	}
	if options.MaxOutput > 0 {
		params["max_output"] = options.MaxOutput
	}
	if options.ResponseFormat != "" {
		params["response_format"] = options.ResponseFormat
	}
	var out AICompletion
	if err := PlatformCall("ai.complete", params, &out); err != nil {
		return AICompletion{}, err
	}
	return out, nil
}

// SavedFile 是 platform_call("files.save") 的返回：保存到调用者文件管理的新文件。
type SavedFile struct {
	FileID    string `json:"file_id"`
	Name      string `json:"name"`
	MediaType string `json:"media_type"`
	Size      int64  `json:"size"`
	Width     int    `json:"width,omitempty"`
	Height    int    `json:"height,omitempty"`
	RefKey    string `json:"ref_key,omitempty"`
}

// FileSave 把新文件保存到调用者本人的文件管理（需要 platform.uses 包含 files.save，且有登录调用者）。
// sourcePath 指向应用自己的 /data 文件，或用 data 直接传内容（受 64 KB 调用载荷限制，较大的文件请先写入应用存储）；
// refKey 非空且声明了 files.reference 时同时登记引用。同名时目标系统自动改名，文件 ≤ 20 MB。
func FileSave(name, sourcePath string, data []byte, refKey string) (SavedFile, error) {
	params := map[string]any{"name": name}
	if sourcePath != "" {
		params["source_path"] = sourcePath
	}
	if len(data) > 0 {
		params["data_b64"] = base64.StdEncoding.EncodeToString(data)
	}
	if refKey != "" {
		params["ref_key"] = refKey
	}
	var out SavedFile
	if err := PlatformCall("files.save", params, &out); err != nil {
		return SavedFile{}, err
	}
	return out, nil
}

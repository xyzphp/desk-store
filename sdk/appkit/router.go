package appkit

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"mime"
	"net/http"
	"net/url"
	"slices"
	"strings"
)

// Handler 处理一次来自宿主的后端请求。
type Handler interface {
	ServeApp(*Context)
}

// HandlerFunc 允许用普通函数作为 Handler。
type HandlerFunc func(*Context)

func (f HandlerFunc) ServeApp(c *Context) { f(c) }

// Context 封装单次请求信息与响应写出方法。
type Context struct {
	Request RequestEnvelope
	params  map[string]string
	body    []byte
	bodyDec bool

	headers map[string]string
	written bool
	resp    ResponseEnvelope
}

func newContext(req RequestEnvelope) *Context {
	return &Context{
		Request: req,
		headers: map[string]string{},
	}
}

func (c *Context) Method() string           { return c.Request.Method }
func (c *Context) Path() string             { return c.Request.Path }
func (c *Context) RawQuery() string         { return c.Request.Query }
func (c *Context) Entry() string            { return c.Request.Context.Entry }
func (c *Context) Route() string            { return c.Request.Context.Route }
func (c *Context) Locale() string           { return c.Request.Context.Locale }
func (c *Context) User() *User              { return c.Request.Context.User }
func (c *Context) Permissions() []string    { return c.Request.Context.Permissions }
func (c *Context) Param(name string) string { return c.params[name] }

func (c *Context) HasPermission(name string) bool {
	return slices.Contains(c.Request.Context.Permissions, name)
}

func (c *Context) Query() url.Values {
	v, err := url.ParseQuery(c.Request.Query)
	if err != nil {
		return url.Values{}
	}
	return v
}

func (c *Context) Header(name string) string {
	return c.Request.Headers[strings.ToLower(name)]
}

func (c *Context) Body() ([]byte, error) {
	if c.bodyDec {
		return c.body, nil
	}
	c.bodyDec = true
	if c.Request.BodyB64 == "" {
		return nil, nil
	}
	raw, err := base64.StdEncoding.DecodeString(c.Request.BodyB64)
	if err != nil {
		return nil, err
	}
	c.body = raw
	return raw, nil
}

// BindJSON 将请求体解码为 JSON。
func (c *Context) BindJSON(dst any) error {
	raw, err := c.Body()
	if err != nil {
		return err
	}
	if len(bytes.TrimSpace(raw)) == 0 {
		return errors.New("empty JSON body")
	}
	return json.Unmarshal(raw, dst)
}

// ParseUpload 解析大文件直传请求体中的 upload 元数据。
func (c *Context) ParseUpload() (UploadInfo, error) {
	var wrapper struct {
		Upload *UploadInfo `json:"upload"`
	}
	if err := c.BindJSON(&wrapper); err != nil {
		return UploadInfo{}, err
	}
	if wrapper.Upload == nil || wrapper.Upload.Path == "" {
		return UploadInfo{}, errors.New("missing upload metadata")
	}
	return *wrapper.Upload, nil
}

// ParseSchedule 解析定时任务请求体中的调度载荷。
func (c *Context) ParseSchedule() (ScheduleEvent, error) {
	var ev ScheduleEvent
	if err := c.BindJSON(&ev); err != nil {
		return ScheduleEvent{}, err
	}
	return ev, nil
}

// SetHeader 设置响应头（须符合 ABI 1 响应头白名单）。
func (c *Context) SetHeader(name, value string) {
	c.headers[strings.ToLower(strings.TrimSpace(name))] = value
}

func (c *Context) Bytes(status int, contentType string, data []byte) {
	if contentType != "" {
		c.SetHeader("content-type", contentType)
	}
	c.resp = ResponseEnvelope{
		Status:  status,
		Headers: cloneMap(c.headers),
	}
	if len(data) > 0 {
		c.resp.BodyB64 = base64.StdEncoding.EncodeToString(data)
	}
	c.written = true
}

func (c *Context) Text(status int, text string) {
	c.Bytes(status, "text/plain; charset=utf-8", []byte(text))
}

func (c *Context) JSON(status int, payload any) {
	raw, err := json.Marshal(payload)
	if err != nil {
		c.Error(http.StatusInternalServerError, "encode response failed")
		return
	}
	c.Bytes(status, "application/json; charset=utf-8", raw)
}

func (c *Context) Error(status int, message string) {
	raw, _ := json.Marshal(map[string]any{"ok": false, "error": message})
	c.Bytes(status, "application/json; charset=utf-8", raw)
}

func (c *Context) NoContent() {
	c.resp = ResponseEnvelope{
		Status:  http.StatusNoContent,
		Headers: cloneMap(c.headers),
	}
	c.written = true
}

// SendFile 指示宿主直接流式发送 /data/<scope>/... 文件（不经过 1 MB 响应体限制）。
func (c *Context) SendFile(status int, virtualPath, contentType, downloadFilename string) {
	if status == 0 {
		status = http.StatusOK
	}
	if contentType != "" {
		c.SetHeader("content-type", contentType)
	}
	if downloadFilename != "" {
		c.SetHeader("content-disposition", mime.FormatMediaType("attachment", map[string]string{"filename": downloadFilename}))
	}
	c.resp = ResponseEnvelope{
		Status:   status,
		Headers:  cloneMap(c.headers),
		SendFile: virtualPath,
	}
	c.written = true
}

// SendUserFile 指示宿主直接流式发送已被本应用登记引用的用户文件（fileID 为 file:<id>，需要 platform.uses 包含 files.reference）。
// inline 为 true 时浏览器内联显示（HTML / SVG / 脚本类型仍由宿主强制下载）。
func (c *Context) SendUserFile(status int, fileID string, inline bool) {
	if status == 0 {
		status = http.StatusOK
	}
	if inline {
		c.SetHeader("content-disposition", "inline")
	}
	c.resp = ResponseEnvelope{
		Status:   status,
		Headers:  cloneMap(c.headers),
		SendFile: fileID,
	}
	c.written = true
}

// Response 返回当前已构建的响应信封（未写出时默认 204）。
func (c *Context) Response() ResponseEnvelope {
	if !c.written {
		return ResponseEnvelope{Status: http.StatusNoContent}
	}
	return c.resp
}

func cloneMap(src map[string]string) map[string]string {
	if len(src) == 0 {
		return nil
	}
	dst := make(map[string]string, len(src))
	for k, v := range src {
		dst[k] = v
	}
	return dst
}

// Router 提供按方法与路径模式（精确、:param 参数与 /* 后缀通配）分发的轻量路由器。
type Router struct {
	routes   []routeEntry
	notFound HandlerFunc
}

type routeEntry struct {
	method   string
	pattern  string
	segments []string
	wildcard bool
	handler  HandlerFunc
}

func NewRouter() *Router {
	return &Router{}
}

func (r *Router) NotFound(h HandlerFunc) { r.notFound = h }

func (r *Router) Handle(method, pattern string, h HandlerFunc) {
	method = strings.ToUpper(strings.TrimSpace(method))
	if !strings.HasPrefix(pattern, "/") {
		pattern = "/" + pattern
	}
	wildcard := strings.HasSuffix(pattern, "/*")
	trimmed := strings.TrimPrefix(pattern, "/")
	if wildcard {
		trimmed = strings.TrimSuffix(trimmed, "/*")
	}
	var segments []string
	if trimmed != "" {
		segments = strings.Split(trimmed, "/")
	}
	r.routes = append(r.routes, routeEntry{
		method:   method,
		pattern:  pattern,
		segments: segments,
		wildcard: wildcard,
		handler:  h,
	})
}

func (r *Router) Get(pattern string, h HandlerFunc)    { r.Handle(http.MethodGet, pattern, h) }
func (r *Router) Head(pattern string, h HandlerFunc)   { r.Handle(http.MethodHead, pattern, h) }
func (r *Router) Post(pattern string, h HandlerFunc)   { r.Handle(http.MethodPost, pattern, h) }
func (r *Router) Put(pattern string, h HandlerFunc)    { r.Handle(http.MethodPut, pattern, h) }
func (r *Router) Patch(pattern string, h HandlerFunc)  { r.Handle(http.MethodPatch, pattern, h) }
func (r *Router) Delete(pattern string, h HandlerFunc) { r.Handle(http.MethodDelete, pattern, h) }

// HandleHook 注册公开回调处理函数（对应 /hooks/<name>）。
func (r *Router) HandleHook(method, name string, h HandlerFunc) {
	r.Handle(method, "/hooks/"+strings.TrimPrefix(name, "/"), h)
}

// HandleSchedule 注册定时任务处理函数（对应 manifest 中声明的 POST 路由）。
func (r *Router) HandleSchedule(route string, h HandlerFunc) {
	r.Post(route, h)
}

func (r *Router) ServeApp(c *Context) {
	reqPath := c.Request.Path
	if reqPath == "" {
		reqPath = "/"
	}
	reqSegs := splitPathSegments(reqPath)
	methodMatched := false
	pathMatched := false
	for _, entry := range r.routes {
		params, ok := matchRouteEntry(entry, reqSegs)
		if !ok {
			continue
		}
		pathMatched = true
		if entry.method != "*" && entry.method != c.Request.Method {
			continue
		}
		methodMatched = true
		c.params = params
		entry.handler(c)
		return
	}
	if pathMatched && !methodMatched {
		c.Error(http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if r.notFound != nil {
		r.notFound(c)
		return
	}
	c.Error(http.StatusNotFound, "not found")
}

func splitPathSegments(p string) []string {
	trimmed := strings.Trim(p, "/")
	if trimmed == "" {
		return nil
	}
	return strings.Split(trimmed, "/")
}

func matchRouteEntry(entry routeEntry, reqSegs []string) (map[string]string, bool) {
	if entry.wildcard {
		if len(reqSegs) < len(entry.segments) {
			return nil, false
		}
	} else if len(reqSegs) != len(entry.segments) {
		return nil, false
	}
	var params map[string]string
	for i, seg := range entry.segments {
		if strings.HasPrefix(seg, ":") && len(seg) > 1 {
			if params == nil {
				params = map[string]string{}
			}
			params[seg[1:]] = reqSegs[i]
			continue
		}
		if seg != reqSegs[i] {
			return nil, false
		}
	}
	if entry.wildcard {
		if params == nil {
			params = map[string]string{}
		}
		params["*"] = strings.Join(reqSegs[len(entry.segments):], "/")
	}
	return params, true
}

// Dispatch 是 //go:wasmexport handle 的入口辅助函数：读取请求信封、分发给 handler 并写出响应信封。
func Dispatch(handler Handler) int32 {
	raw, err := abiReadRequest()
	if err != nil {
		return 1
	}
	var req RequestEnvelope
	if err := json.Unmarshal(raw, &req); err != nil {
		return 1
	}
	ctx := newContext(req)
	handler.ServeApp(ctx)
	encoded, err := json.Marshal(ctx.Response())
	if err != nil {
		return 1
	}
	if err := abiWriteResponse(encoded); err != nil {
		return 1
	}
	return 0
}

// DispatchMigrate 是可选 //go:wasmexport migrate 的入口辅助函数。
// fn 返回 nil 时返回 0；返回错误时把错误信息写入响应体并返回 1，供宿主展示并触发回滚。
func DispatchMigrate(fn func(MigrateEvent) error) int32 {
	raw, err := abiReadRequest()
	if err != nil {
		return 1
	}
	var req RequestEnvelope
	if err := json.Unmarshal(raw, &req); err != nil {
		return 1
	}
	var ev MigrateEvent
	if req.BodyB64 != "" {
		body, err := base64.StdEncoding.DecodeString(req.BodyB64)
		if err != nil {
			return 1
		}
		if err := json.Unmarshal(body, &ev); err != nil {
			return 1
		}
	}
	if err := fn(ev); err != nil {
		resp, _ := json.Marshal(ResponseEnvelope{
			Status:  http.StatusInternalServerError,
			Headers: map[string]string{"content-type": "text/plain; charset=utf-8"},
			BodyB64: base64.StdEncoding.EncodeToString([]byte(err.Error())),
		})
		_ = abiWriteResponse(resp)
		return 1
	}
	return 0
}

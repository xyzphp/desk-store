package appspec

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
)

// 格式 2 的后端模块声明，合同见 docs/spec/02-backend.md 第 2 节。

var (
	backendNamePattern = regexp.MustCompile(`^[a-z][a-z0-9-]{1,31}$`)
	configKeyPattern   = regexp.MustCompile(`^[a-z][a-z0-9_]{1,31}$`)
	rateLimitPattern   = regexp.MustCompile(`^[1-9][0-9]{0,5}/(s|min|h)$`)
	hostnamePattern    = regexp.MustCompile(`^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`)
	cronFieldPattern   = regexp.MustCompile(`^[0-9*,/-]+$`)
)

// Backend 是后端模块声明。
type Backend struct {
	Runtime   string          `json:"runtime"`
	ABI       int             `json:"abi"`
	Module    string          `json:"module"`
	Limits    *BackendLimits  `json:"limits,omitempty"`
	Routes    []BackendRoute  `json:"routes,omitempty"`
	Storage   *BackendStorage `json:"storage,omitempty"`
	HTTP      *BackendHTTP    `json:"http,omitempty"`
	Hooks     []BackendHook   `json:"hooks,omitempty"`
	Schedules []Schedule      `json:"schedules,omitempty"`
	Config    []ConfigItem    `json:"config,omitempty"`
}

// BackendLimits 调整单次执行的时长与内存。
type BackendLimits struct {
	TimeoutMS int `json:"timeout_ms,omitempty"`
	MemoryMB  int `json:"memory_mb,omitempty"`
}

// BackendRoute 是前端或其他入口可以调用的后端路由。
type BackendRoute struct {
	Path       string   `json:"path"`
	Methods    []string `json:"methods"`
	Visibility string   `json:"visibility"`
	RateLimit  string   `json:"rate_limit,omitempty"`
}

// BackendStorage 声明使用的存储范围与配额（MB）。
type BackendStorage struct {
	Shared     bool `json:"shared,omitempty"`
	Public     bool `json:"public,omitempty"`
	Account    bool `json:"account,omitempty"`
	FilesMB    int  `json:"files_mb,omitempty"`
	DatabaseMB int  `json:"database_mb,omitempty"`
}

// BackendHTTP 是后端可以访问的外部主机白名单。
type BackendHTTP struct {
	Allow []HTTPAllow `json:"allow"`
}

// HTTPAllow 是一个允许的主机（可带端口）与方法。
type HTTPAllow struct {
	Host    string   `json:"host"`
	Methods []string `json:"methods"`
}

// BackendHook 是公开回调。
type BackendHook struct {
	Name string `json:"name"`
}

// Schedule 是定时任务。
type Schedule struct {
	Name  string `json:"name"`
	Cron  string `json:"cron"`
	Route string `json:"route"`
}

// ConfigItem 是安装时由管理员填写的配置项。
type ConfigItem struct {
	Key    string `json:"key"`
	Title  string `json:"title"`
	Secret bool   `json:"secret,omitempty"`
}

var routeMethods = map[string]bool{
	http.MethodGet: true, http.MethodHead: true, http.MethodPost: true, http.MethodPut: true, http.MethodPatch: true, http.MethodDelete: true,
}

// StorageScopes 返回启用的存储范围（shared、public、account 顺序）。
func (b *Backend) StorageScopes() []string {
	scopes := []string{}
	if b == nil || b.Storage == nil {
		return scopes
	}
	if b.Storage.Shared {
		scopes = append(scopes, "shared")
	}
	if b.Storage.Public {
		scopes = append(scopes, "public")
	}
	if b.Storage.Account {
		scopes = append(scopes, "account")
	}
	return scopes
}

// hasRoute 判断某个路径与方法是否被路由声明覆盖；末尾 * 表示前缀。
func (b *Backend) hasRoute(target, method string) bool {
	if b == nil {
		return false
	}
	for _, route := range b.Routes {
		matches := route.Path == target
		if prefix, ok := strings.CutSuffix(route.Path, "*"); ok {
			matches = strings.HasPrefix(target, prefix)
		}
		if !matches {
			continue
		}
		for _, allowed := range route.Methods {
			if allowed == method {
				return true
			}
		}
	}
	return false
}

func (m *Manifest) validateBackend(files []File) error {
	b := m.Backend
	if b == nil {
		return nil
	}
	if b.Runtime != "wasm" || b.ABI != 1 {
		return errors.New("backend 当前只支持 runtime: wasm、abi: 1")
	}
	if b.Module != BackendModulePath {
		return fmt.Errorf("backend.module 必须是 %s", BackendModulePath)
	}
	if _, found := fileByPath(files, b.Module); !found {
		return fmt.Errorf("后端模块 %s 在安装包中不存在", b.Module)
	}
	if l := b.Limits; l != nil {
		if l.TimeoutMS != 0 && (l.TimeoutMS < 100 || l.TimeoutMS > 30000) {
			return errors.New("backend.limits.timeout_ms 必须在 100-30000 之间")
		}
		if l.MemoryMB != 0 && (l.MemoryMB < 16 || l.MemoryMB > 256) {
			return errors.New("backend.limits.memory_mb 必须在 16-256 之间")
		}
	}
	if err := m.validateRoutes(); err != nil {
		return err
	}
	if s := b.Storage; s != nil {
		if s.FilesMB != 0 && (s.FilesMB < 1 || s.FilesMB > 102400) {
			return errors.New("backend.storage.files_mb 必须在 1-102400 之间")
		}
		if s.DatabaseMB != 0 && (s.DatabaseMB < 1 || s.DatabaseMB > 10240) {
			return errors.New("backend.storage.database_mb 必须在 1-10240 之间")
		}
	}
	if err := validateHTTPAllow(b.HTTP); err != nil {
		return err
	}
	if len(b.Hooks) > 8 {
		return errors.New("backend.hooks 过多（上限 8）")
	}
	hooks := map[string]bool{}
	for _, hook := range b.Hooks {
		if !backendNamePattern.MatchString(hook.Name) || hooks[hook.Name] {
			return fmt.Errorf("backend.hooks 中的 %q 无效或重复", hook.Name)
		}
		hooks[hook.Name] = true
	}
	if err := b.validateSchedules(); err != nil {
		return err
	}
	if len(b.Config) > 16 {
		return errors.New("backend.config 过多（上限 16）")
	}
	keys := map[string]bool{}
	for _, item := range b.Config {
		if !configKeyPattern.MatchString(item.Key) || keys[item.Key] {
			return fmt.Errorf("backend.config 中的 key %q 无效或重复", item.Key)
		}
		keys[item.Key] = true
		if strings.TrimSpace(item.Title) == "" || len([]rune(item.Title)) > 32 {
			return fmt.Errorf("backend.config 中 %q 的 title 必须是 1-32 个字符", item.Key)
		}
	}
	return validateMigrations(b, files)
}

func (m *Manifest) validateRoutes() error {
	routes := m.Backend.Routes
	if len(routes) > 64 {
		return errors.New("backend.routes 过多（上限 64）")
	}
	seen := map[string]bool{}
	for i := range routes {
		route := &routes[i]
		base, prefix := strings.CutSuffix(route.Path, "*")
		if prefix && !strings.HasSuffix(base, "/") {
			return fmt.Errorf("backend.routes 第 %d 项：前缀路由必须以 /* 结尾", i+1)
		}
		clean, err := normalizeAllowedPath(base)
		if err != nil {
			return fmt.Errorf("backend.routes 第 %d 项的 path：%w", i+1, err)
		}
		if prefix {
			clean += "*"
		}
		route.Path = clean
		if len(route.Methods) == 0 {
			return fmt.Errorf("backend.routes 第 %d 项必须声明 methods", i+1)
		}
		for _, method := range route.Methods {
			if !routeMethods[method] {
				return fmt.Errorf("backend.routes 第 %d 项的方法 %q 不支持", i+1, method)
			}
			key := method + " " + route.Path
			if seen[key] {
				return fmt.Errorf("backend.routes 中的 %s 重复", key)
			}
			seen[key] = true
		}
		if err := m.checkVisibility(route.Visibility, true); err != nil {
			return fmt.Errorf("backend.routes 第 %d 项：%w", i+1, err)
		}
		if route.RateLimit != "" && !rateLimitPattern.MatchString(route.RateLimit) {
			return fmt.Errorf("backend.routes 第 %d 项的 rate_limit 格式应为 次数/s|min|h", i+1)
		}
	}
	return nil
}

func validateHTTPAllow(config *BackendHTTP) error {
	if config == nil {
		return nil
	}
	if len(config.Allow) == 0 || len(config.Allow) > 16 {
		return errors.New("backend.http.allow 必须声明 1-16 个主机")
	}
	seen := map[string]bool{}
	for i, allow := range config.Allow {
		host, port, err := net.SplitHostPort(allow.Host)
		if err != nil {
			host, port = allow.Host, ""
		}
		if host != strings.ToLower(host) || !hostnamePattern.MatchString(host) || net.ParseIP(host) != nil {
			return fmt.Errorf("backend.http.allow 第 %d 项的主机 %q 无效（只写小写域名，可带端口，不写协议或 IP）", i+1, allow.Host)
		}
		if port != "" {
			if number, err := strconv.Atoi(port); err != nil || number < 1 || number > 65535 {
				return fmt.Errorf("backend.http.allow 第 %d 项的端口无效", i+1)
			}
		}
		if seen[allow.Host] {
			return fmt.Errorf("backend.http.allow 中的主机 %q 重复", allow.Host)
		}
		seen[allow.Host] = true
		if len(allow.Methods) == 0 {
			return fmt.Errorf("backend.http.allow 第 %d 项必须声明 methods", i+1)
		}
		for _, method := range allow.Methods {
			if !routeMethods[method] {
				return fmt.Errorf("backend.http.allow 第 %d 项的方法 %q 不支持", i+1, method)
			}
		}
	}
	return nil
}

func (b *Backend) validateSchedules() error {
	if len(b.Schedules) > 8 {
		return errors.New("backend.schedules 过多（上限 8）")
	}
	names := map[string]bool{}
	for _, schedule := range b.Schedules {
		if !backendNamePattern.MatchString(schedule.Name) || names[schedule.Name] {
			return fmt.Errorf("backend.schedules 中的 %q 无效或重复", schedule.Name)
		}
		names[schedule.Name] = true
		fields := strings.Fields(schedule.Cron)
		if len(fields) != 5 {
			return fmt.Errorf("定时任务 %q 的 cron 必须是五段", schedule.Name)
		}
		for _, field := range fields {
			if !cronFieldPattern.MatchString(field) {
				return fmt.Errorf("定时任务 %q 的 cron 含有不支持的字符", schedule.Name)
			}
		}
		if !minuteIntervalAtLeast(fields[0], 5) {
			return fmt.Errorf("定时任务 %q 的分钟字段无效或执行间隔小于 5 分钟", schedule.Name)
		}
		if !b.hasRoute(schedule.Route, http.MethodPost) {
			return fmt.Errorf("定时任务 %q 的 route %q 没有在 backend.routes 中以 POST 声明", schedule.Name, schedule.Route)
		}
	}
	return nil
}

// minuteIntervalAtLeast 展开 cron 的分钟字段，检查相邻两次执行（含跨小时）至少相隔 gap 分钟。
func minuteIntervalAtLeast(field string, gap int) bool {
	var minutes [60]bool
	for _, item := range strings.Split(field, ",") {
		base, stepText, hasStep := strings.Cut(item, "/")
		step := 1
		if hasStep {
			n, err := strconv.Atoi(stepText)
			if err != nil || n < 1 || n > 59 {
				return false
			}
			step = n
		}
		low, high := 0, 59
		switch {
		case base == "*":
		case strings.Contains(base, "-"):
			from, to, _ := strings.Cut(base, "-")
			a, errA := strconv.Atoi(from)
			b, errB := strconv.Atoi(to)
			if errA != nil || errB != nil || a > b {
				return false
			}
			low, high = a, b
		default:
			n, err := strconv.Atoi(base)
			if err != nil || hasStep {
				return false
			}
			low, high = n, n
		}
		if low < 0 || high > 59 {
			return false
		}
		for value := low; value <= high; value += step {
			minutes[value] = true
		}
	}
	first, previous := -1, -1
	for value, set := range minutes {
		if !set {
			continue
		}
		if first < 0 {
			first = value
		} else if value-previous < gap {
			return false
		}
		previous = value
	}
	if first < 0 {
		return false
	}
	return first == previous || first+60-previous >= gap
}

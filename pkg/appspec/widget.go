package appspec

import (
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
)

var (
	widgetFieldPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*){0,7}$`)
	widgetQueryPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,63}$`)
)

// Widget 是由桌面壳安全渲染的声明式百分比卡片，不执行包内脚本。
type Widget struct {
	Title           string           `json:"title"`
	Proxy           string           `json:"proxy"`
	Path            string           `json:"path"`
	RefreshSeconds  int              `json:"refresh_seconds,omitempty"`
	UpdatedPath     string           `json:"updated_path,omitempty"`
	Metrics         []WidgetMetric   `json:"metrics"`
	AccountSelector *AccountSelector `json:"account_selector,omitempty"`
}

// WidgetMetric 是一项 0-100 的百分比指标。
type WidgetMetric struct {
	Label     string `json:"label"`
	ValuePath string `json:"value_path"`
	ResetPath string `json:"reset_path,omitempty"`
	Invert    bool   `json:"invert,omitempty"`
}

// AccountSelector 让卡片在同一代理的账号列表之间切换。
type AccountSelector struct {
	Path        string `json:"path"`
	ItemsPath   string `json:"items_path"`
	IDPath      string `json:"id_path"`
	LabelPath   string `json:"label_path"`
	DefaultPath string `json:"default_path,omitempty"`
	QueryParam  string `json:"query_param"`
}

func validWidgetField(value string, optional bool) bool {
	if value == "" {
		return optional
	}
	if len(value) > 256 || !widgetFieldPattern.MatchString(value) {
		return false
	}
	for _, part := range strings.Split(value, ".") {
		if part == "__proto__" || part == "prototype" || part == "constructor" {
			return false
		}
	}
	return true
}

func validateWidget(m *Manifest) error {
	widget := m.Widget
	if widget == nil {
		return nil
	}
	if !m.DesktopWidget || len([]rune(widget.Title)) > 64 || len(widget.Metrics) < 1 || len(widget.Metrics) > 4 {
		return errors.New("widget 需要 desktop_widget，标题最多 64 字，指标数量为 1-4")
	}
	if widget.RefreshSeconds == 0 {
		widget.RefreshSeconds = 900
	}
	if widget.RefreshSeconds < 60 || widget.RefreshSeconds > 3600 {
		return errors.New("widget.refresh_seconds 必须在 60-3600 之间")
	}
	if !validWidgetField(widget.UpdatedPath, true) {
		return errors.New("widget.updated_path 必须是 JSON 字段路径")
	}
	for _, metric := range widget.Metrics {
		if strings.TrimSpace(metric.Label) == "" || len([]rune(metric.Label)) > 64 ||
			!validWidgetField(metric.ValuePath, false) || !validWidgetField(metric.ResetPath, true) {
			return errors.New("widget.metrics 指标需声明有效标签、数值字段及可选重置时间字段")
		}
	}
	selector := widget.AccountSelector
	if selector != nil {
		if !validWidgetField(selector.ItemsPath, false) || !validWidgetField(selector.IDPath, false) ||
			!validWidgetField(selector.LabelPath, false) || !validWidgetField(selector.DefaultPath, true) ||
			!widgetQueryPattern.MatchString(selector.QueryParam) {
			return errors.New("widget.account_selector 需要有效的账号字段路径与查询参数名称")
		}
	}
	proxy, found := m.proxy(widget.Proxy)
	if !found {
		return errors.New("widget.proxy 没有对应的代理声明")
	}
	if !proxy.allowsMethod(http.MethodGet) || !proxy.allowsPath(widget.Path) {
		return errors.New("widget 数据路径必须在代理白名单内，且代理须允许 GET")
	}
	if selector != nil && (!proxy.PassQuery || !proxy.allowsPath(selector.Path)) {
		return errors.New("widget.account_selector 列表路径必须在同一代理白名单内，且代理须允许查询参数")
	}
	if !m.hasPermission(widget.Proxy) {
		return fmt.Errorf("widget 代理 %q 必须声明对应的 proxy 权限点", widget.Proxy)
	}
	return nil
}

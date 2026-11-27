package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/xyzphp/desk-store/sdk/appkit"
)

type articleQuoteConfig struct {
	Mode   string `json:"mode"`
	URL    string `json:"url,omitempty"`
	Format string `json:"format,omitempty"`
	Field  string `json:"field,omitempty"`
}

const (
	articleQuoteFetchTimeoutMS = 15000
	articleQuoteMaxBytes       = 32 << 10
)

type articleQuoteFailure struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (f *articleQuoteFailure) Error() string { return f.Message }

type articleQuoteRecord struct {
	Day       string `json:"day"`
	Text      string `json:"text"`
	Status    string `json:"status"`
	Source    string `json:"source"`
	Revision  int64  `json:"revision"`
	FetchedAt int64  `json:"fetchedAt"`
	UpdatedAt int64  `json:"updatedAt"`
}

const articleQuoteColumns = "quote_day, quote_text, status, source, revision, fetched_at, updated_at"

func scanArticleQuote(row interface{ Scan(...any) error }) (articleQuoteRecord, error) {
	var record articleQuoteRecord
	err := row.Scan(&record.Day, &record.Text, &record.Status, &record.Source, &record.Revision, &record.FetchedAt, &record.UpdatedAt)
	return record, err
}

func articleQuoteDay(now time.Time) string {
	return now.In(time.FixedZone("UTC+8", 8*60*60)).Format("2006-01-02")
}

func validArticleQuoteDay(day string) bool {
	parsed, err := time.Parse("2006-01-02", day)
	return err == nil && parsed.Year() >= 1970 && parsed.Year() < 9999 && parsed.Format("2006-01-02") == day
}

func publicArticleSiteConfig(config articleSiteConfig) articleSiteConfig {
	// Only the resolved mode is exposed publicly. Never leak upstream URL or JSON field config.
	config.Quote = articleQuoteConfig{Mode: config.Quote.Mode}
	return config
}

func validArticleQuoteURL(raw string) bool {
	if !validArticleSiteURL(raw) {
		return false
	}
	u, err := url.Parse(raw)
	if err != nil || u.Fragment != "" {
		return false
	}
	host := strings.ToLower(strings.TrimSuffix(u.Hostname(), "."))
	if host == "" || host == "localhost" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".internal") {
		return false
	}
	if addr, err := netip.ParseAddr(host); err == nil {
		if addr.IsLoopback() || addr.IsPrivate() || addr.IsLinkLocalUnicast() || addr.IsLinkLocalMulticast() || addr.IsUnspecified() {
			return false
		}
	}
	return true
}

func validateArticleQuote(config *articleQuoteConfig) error {
	config.URL = strings.TrimSpace(config.URL)
	config.Field = strings.TrimSpace(config.Field)
	if config.Mode == "" {
		config.Mode = "manual"
	}
	if config.Format == "" {
		config.Format = "json"
	}
	if config.Mode != "manual" && config.Mode != "api" && config.Mode != "none" || config.Format != "json" && config.Format != "text" {
		return errArticleInvalid
	}
	if config.URL != "" {
		if !validArticleQuoteURL(config.URL) {
			return errArticleInvalid
		}
	} else if config.Mode == "api" {
		return errArticleInvalid
	}
	if !validArticleText(config.Field, 80, false) {
		return errArticleInvalid
	}
	if config.Field != "" {
		parts := strings.Split(config.Field, ".")
		if len(parts) > 8 {
			return errArticleInvalid
		}
		for _, part := range parts {
			if part == "" {
				return errArticleInvalid
			}
			for _, ch := range part {
				if ch != '_' && ch != '-' && !(ch >= 'a' && ch <= 'z') && !(ch >= 'A' && ch <= 'Z') && !(ch >= '0' && ch <= '9') {
					return errArticleInvalid
				}
			}
		}
	}
	return nil
}

func decodeArticleQuote(data []byte, config articleQuoteConfig) (string, error) {
	invalidContent := &articleQuoteFailure{Code: "content", Message: "一言接口未返回有效文案，请检查返回格式和文案字段"}
	invalidField := &articleQuoteFailure{Code: "field", Message: "文案字段不存在或不是文字，请检查文案字段"}
	if len(data) == 0 || !utf8.Valid(data) {
		return "", invalidContent
	}
	text := string(data)
	if config.Format == "json" {
		var value any
		if err := json.Unmarshal(data, &value); err != nil {
			return "", invalidContent
		}
		if config.Field != "" {
			for _, part := range strings.Split(config.Field, ".") {
				switch node := value.(type) {
				case map[string]any:
					value = node[part]
				case []any:
					index, err := strconv.Atoi(part)
					if err != nil || index < 0 || index >= len(node) {
						return "", invalidField
					}
					value = node[index]
				default:
					return "", invalidField
				}
			}
		}
		var ok bool
		text, ok = value.(string)
		if !ok {
			return "", invalidField
		}
	}
	text = strings.TrimSpace(text)
	if text == "" || !validArticleText(text, 240, false) {
		return "", invalidContent
	}
	return text, nil
}

func responseHeaderCI(headers map[string]string, key string) string {
	for k, v := range headers {
		if strings.EqualFold(k, key) {
			return v
		}
	}
	return ""
}

func fetchArticleQuote(config articleQuoteConfig) (string, error) {
	if validateArticleQuote(&config) != nil || config.Mode != "api" {
		return "", &articleQuoteFailure{Code: "config", Message: "请检查一言接口配置"}
	}
	resp, err := appkit.HTTPFetch(appkit.HTTPRequest{
		Method: http.MethodGet,
		URL:    config.URL,
		Headers: map[string]string{
			"accept": "application/json,text/plain;q=0.9",
		},
		TimeoutMS: articleQuoteFetchTimeoutMS,
	})
	if err != nil {
		switch {
		case appkit.IsCode(err, appkit.CodeDenied):
			return "", &articleQuoteFailure{Code: "denied", Message: "目标主机未加入外联白名单，请在「应用管理 → 外联主机」中添加该域名后再试"}
		case appkit.IsCode(err, appkit.CodeTimeout):
			return "", &articleQuoteFailure{Code: "timeout", Message: "一言接口响应超时，请稍后重试"}
		case appkit.IsCode(err, appkit.CodeLimit):
			return "", &articleQuoteFailure{Code: "size", Message: "一言接口返回内容过大，请检查接口地址"}
		default:
			return "", &articleQuoteFailure{Code: "network", Message: "无法连接一言接口，请检查服务器网络或接口地址"}
		}
	}
	if resp.Status < 200 || resp.Status >= 300 {
		message := fmt.Sprintf("一言接口返回 HTTP %d，请稍后重试或检查接口地址", resp.Status)
		if resp.Status >= 300 && resp.Status < 400 {
			message = "一言接口返回了跳转，请填写最终接口地址"
		} else if resp.Status == http.StatusTooManyRequests {
			message = "一言接口请求过于频繁，请稍后重试"
		}
		return "", &articleQuoteFailure{Code: "upstream", Message: message}
	}
	contentType, _, err := mime.ParseMediaType(responseHeaderCI(resp.Headers, "content-type"))
	if err != nil || config.Format == "text" && contentType != "text/plain" || config.Format == "json" && contentType != "application/json" && !strings.HasSuffix(contentType, "+json") {
		return "", &articleQuoteFailure{Code: "format", Message: "一言接口返回格式不匹配，请检查返回格式"}
	}
	if len(resp.Body) > articleQuoteMaxBytes {
		return "", &articleQuoteFailure{Code: "size", Message: "一言接口返回内容过大，请检查接口地址"}
	}
	return decodeArticleQuote(resp.Body, config)
}

func syncPublicQuote(pubDB *sql.DB, day, text string) error {
	if strings.TrimSpace(text) == "" {
		return nil
	}
	_, err := pubDB.Exec(
		`INSERT INTO public_site_quotes(quote_day, quote_text) VALUES(?, ?)
		 ON CONFLICT(quote_day) DO UPDATE SET quote_text = excluded.quote_text`,
		day, text,
	)
	return err
}

func finishArticleQuote(sharedDB, pubDB *sql.DB, config articleQuoteConfig, day string, revision int64) (articleQuoteRecord, *articleQuoteFailure, error) {
	config.Mode = "api"
	text, fetchErr := fetchArticleQuote(config)
	var failure *articleQuoteFailure
	now := time.Now().UnixMilli()
	var (
		res sql.Result
		err error
	)
	if fetchErr != nil {
		if !errors.As(fetchErr, &failure) {
			failure = &articleQuoteFailure{Code: "network", Message: "无法连接一言接口，请检查服务器网络或接口地址"}
		}
		res, err = sharedDB.Exec(
			`UPDATE article_site_quotes SET status = 'failed', revision = revision + 1, updated_at = ? WHERE quote_day = ? AND revision = ? AND status = 'pending'`,
			now, day, revision,
		)
	} else {
		res, err = sharedDB.Exec(
			`UPDATE article_site_quotes SET quote_text = ?, status = 'ready', revision = revision + 1, updated_at = ? WHERE quote_day = ? AND revision = ? AND status = 'pending'`,
			text, now, day, revision,
		)
	}
	if err != nil {
		return articleQuoteRecord{}, nil, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return articleQuoteRecord{}, nil, err
	}
	if n == 0 {
		return articleQuoteRecord{}, nil, errArticleConflict
	}
	record, err := scanArticleQuote(sharedDB.QueryRow(`SELECT `+articleQuoteColumns+` FROM article_site_quotes WHERE quote_day = ?`, day))
	if err != nil {
		return articleQuoteRecord{}, failure, err
	}
	if record.Status == "ready" && record.Text != "" {
		_ = syncPublicQuote(pubDB, record.Day, record.Text)
	}
	return record, failure, nil
}

func articleQuoteAPIError(c *appkit.Context, err error) {
	switch {
	case errors.Is(err, errArticleConflict):
		c.Error(http.StatusConflict, "一言记录已更新，当前输入已保留，请重新读取后再保存")
	case errors.Is(err, errArticleInvalid):
		c.Error(http.StatusBadRequest, "请检查一言接口、日期和文案")
	default:
		articleAPIError(c, err)
	}
}

func handleListQuotes(c *appkit.Context) {
	if _, ok := requireUser(c); !ok {
		return
	}
	if !c.HasPermission("site.settings") {
		c.Error(http.StatusForbidden, "只有拥有站点设置权限的成员可以管理一言记录")
		return
	}
	before := strings.TrimSpace(c.Query().Get("before"))
	if before != "" && !validArticleQuoteDay(before) {
		articleQuoteAPIError(c, errArticleInvalid)
		return
	}
	sharedDB := appkit.OpenDB("shared")
	var (
		rows *sql.Rows
		err  error
	)
	if before != "" {
		rows, err = sharedDB.Query(`SELECT `+articleQuoteColumns+` FROM article_site_quotes WHERE quote_day < ? ORDER BY quote_day DESC LIMIT 31`, before)
	} else {
		rows, err = sharedDB.Query(`SELECT ` + articleQuoteColumns + ` FROM article_site_quotes ORDER BY quote_day DESC LIMIT 31`)
	}
	if err != nil {
		articleQuoteAPIError(c, err)
		return
	}
	items := []articleQuoteRecord{}
	for rows.Next() {
		record, scanErr := scanArticleQuote(rows)
		if scanErr != nil {
			err = scanErr
			break
		}
		items = append(items, record)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		articleQuoteAPIError(c, err)
		return
	}
	more := len(items) > 30
	if more {
		items = items[:30]
	}
	today := articleQuoteDay(time.Now())
	current, err := scanArticleQuote(sharedDB.QueryRow(`SELECT `+articleQuoteColumns+` FROM article_site_quotes WHERE quote_day = ?`, today))
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		articleQuoteAPIError(c, err)
		return
	}
	c.JSON(http.StatusOK, map[string]any{
		"ok":              true,
		"items":           items,
		"more":            more,
		"today":           today,
		"currentRevision": current.Revision,
	})
}

func handleMutateQuote(c *appkit.Context) {
	if _, ok := requireUser(c); !ok {
		return
	}
	if !c.HasPermission("site.settings") {
		c.Error(http.StatusForbidden, "只有拥有站点设置权限的成员可以管理一言记录")
		return
	}
	var req struct {
		Action   string `json:"action"`
		Day      string `json:"day"`
		Text     string `json:"text"`
		Revision int64  `json:"revision"`
	}
	if !decodeStrictJSON(c, &req, 16<<10) {
		return
	}
	if !validArticleQuoteDay(req.Day) || req.Revision < 0 {
		articleQuoteAPIError(c, errArticleInvalid)
		return
	}
	sharedDB := appkit.OpenDB("shared")
	pubDB := appkit.OpenDB("public")
	var failure *articleQuoteFailure

	switch {
	case req.Action == "edit":
		req.Text = strings.TrimSpace(req.Text)
		if req.Text == "" || !validArticleText(req.Text, 240, false) {
			c.Error(http.StatusBadRequest, "请输入不超过 240 字符的一言文案")
			return
		}
		res, err := sharedDB.Exec(
			`UPDATE article_site_quotes SET quote_text = ?, status = 'ready', source = 'manual', revision = revision + 1, updated_at = ? WHERE quote_day = ? AND revision = ?`,
			req.Text, time.Now().UnixMilli(), req.Day, req.Revision,
		)
		if err == nil {
			n, rErr := res.RowsAffected()
			if rErr != nil {
				err = rErr
			} else if n == 0 {
				err = errArticleConflict
			}
		}
		if err != nil {
			articleQuoteAPIError(c, err)
			return
		}
		_ = syncPublicQuote(pubDB, req.Day, req.Text)

	case req.Action == "fetch" && req.Day == articleQuoteDay(time.Now()) && req.Text == "":
		site, err := loadArticleSite(sharedDB)
		if err != nil {
			articleQuoteAPIError(c, err)
			return
		}
		cfg := site.Config.Quote
		cfg.Mode = "api"
		if validateArticleQuote(&cfg) != nil {
			c.Error(http.StatusBadRequest, "请先保存有效的一言接口配置")
			return
		}
		now := time.Now().UnixMilli()
		var res sql.Result
		if req.Revision == 0 {
			res, err = sharedDB.Exec(
				`INSERT OR IGNORE INTO article_site_quotes(quote_day, quote_text, status, source, revision, fetched_at, updated_at) VALUES(?, '', 'pending', 'api', 1, ?, ?)`,
				req.Day, now, now,
			)
		} else {
			res, err = sharedDB.Exec(
				`UPDATE article_site_quotes SET status = 'pending', source = 'api', revision = revision + 1, fetched_at = ?, updated_at = ? WHERE quote_day = ? AND revision = ? AND (status <> 'pending' OR fetched_at < ?)`,
				now, now, req.Day, req.Revision, now-30000,
			)
		}
		if err == nil {
			n, rErr := res.RowsAffected()
			if rErr != nil {
				err = rErr
			} else if n == 0 {
				err = errArticleConflict
			}
		}
		if err == nil {
			_, failure, err = finishArticleQuote(sharedDB, pubDB, cfg, req.Day, req.Revision+1)
		}
		if err != nil {
			articleQuoteAPIError(c, err)
			return
		}

	default:
		articleQuoteAPIError(c, errArticleInvalid)
		return
	}

	item, err := scanArticleQuote(sharedDB.QueryRow(`SELECT `+articleQuoteColumns+` FROM article_site_quotes WHERE quote_day = ?`, req.Day))
	if err != nil {
		articleQuoteAPIError(c, err)
		return
	}
	resp := map[string]any{"ok": true, "item": item}
	if failure != nil {
		resp["failure"] = failure
	}
	c.JSON(http.StatusOK, resp)
}

func handleDailyQuoteSchedule(c *appkit.Context) {
	if c.Entry() != "schedule" {
		c.Error(http.StatusForbidden, "仅定时任务可触发")
		return
	}
	sharedDB := appkit.OpenDB("shared")
	pubDB := appkit.OpenDB("public")
	site, err := loadArticleSite(sharedDB)
	if err != nil {
		articleQuoteAPIError(c, err)
		return
	}
	if site.Config.Quote.Mode != "api" {
		c.JSON(http.StatusOK, map[string]any{"ok": true, "skipped": true})
		return
	}
	day := articleQuoteDay(time.Now())
	now := time.Now().UnixMilli()
	res, err := sharedDB.Exec(
		`INSERT OR IGNORE INTO article_site_quotes(quote_day, quote_text, status, source, revision, fetched_at, updated_at) VALUES(?, '', 'pending', 'api', 1, ?, ?)`,
		day, now, now,
	)
	if err != nil {
		articleQuoteAPIError(c, err)
		return
	}
	changed, _ := res.RowsAffected()
	if changed == 0 {
		c.JSON(http.StatusOK, map[string]any{"ok": true, "day": day, "claimed": false})
		return
	}
	item, failure, err := finishArticleQuote(sharedDB, pubDB, site.Config.Quote, day, 1)
	if err != nil {
		articleQuoteAPIError(c, err)
		return
	}
	resp := map[string]any{"ok": true, "day": day, "claimed": true, "item": item}
	if failure != nil {
		resp["failure"] = failure
	}
	c.JSON(http.StatusOK, resp)
}

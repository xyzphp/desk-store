package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/xyzphp/desk-store/sdk/appkit"
)

const (
	maxUserArticles     = 500
	articleTitleLimit   = 160
	articleSummaryLimit = 500
	articleContentLimit = 80000
	articleBodyMaxBytes = 384 << 10
)

var (
	errArticleConflict = errors.New("article revision conflict")
	errArticleInvalid  = errors.New("invalid article")
	errArticleInUse    = errors.New("article taxonomy in use")
	errArticleDenied   = errors.New("article forbidden")
)

func buildRouter() *appkit.Router {
	r := appkit.NewRouter()

	// 工作台与个人令牌 REST 接口（与内置文章管理同形）
	r.Get("/articles", handleListArticles)
	r.Post("/articles", handleCreateArticle)
	r.Get("/articles/:id", handleGetArticle)
	r.Put("/articles/:id", handleUpdateArticle)
	r.Post("/articles/:id/actions", handleArticleAction)
	r.Get("/articles/:id/files/:fileId", handleArticleDraftFile)
	r.Head("/articles/:id/files/:fileId", handleArticleDraftFile)

	// 个人令牌细分权限点路由（publish / write / delete 各自隔离）
	r.Post("/publish/:id", handleTokenPublishArticle)
	r.Post("/publish/:id/unpublish", handleTokenUnpublishArticle)
	r.Post("/restore/:id", handleTokenRestoreArticle)

	// 分类与标签
	r.Post("/taxonomies", handleTaxonomy)
	r.Delete("/taxonomies/:id", handleTokenDeleteTaxonomy)

	// 文件登记、上传与受保护内容读取
	r.Get("/files", handleListFiles)
	r.Post("/files/register", handleRegisterFile)
	r.Post("/files/upload", handleUploadFile)
	r.Get("/files/content/:fileId", handleFileContent)
	r.Head("/files/content/:fileId", handleFileContent)

	// 站点设置与每日一言（permission:site.settings）
	r.Get("/site", handleGetSite)
	r.Put("/site", handlePutSite)
	r.Get("/site/quotes", handleListQuotes)
	r.Post("/site/quotes", handleMutateQuote)
	r.HandleSchedule("/jobs/daily-quote", handleDailyQuoteSchedule)

	// 内置站点配置一次性导入（builtin_import）
	r.Post("/import/builtin", handleBuiltinImport)

	// MCP 工具与只读资源
	r.Post("/tools/list-articles", handleToolListArticles)
	r.Post("/tools/get-article", handleToolGetArticle)
	r.Post("/tools/create-article", handleToolCreateArticle)
	r.Post("/tools/save-article", handleToolSaveArticle)
	r.Post("/tools/article-action", handleToolArticleAction)
	r.Post("/tools/save-article-taxonomy", handleToolSaveArticleTaxonomy)
	r.Post("/tools/list-article-files", handleToolListArticleFiles)
	r.Post("/resources/recent", handleResourceRecent)
	r.Post("/resources/taxonomies", handleResourceTaxonomies)

	// 公开阅读站接口（仅只读 public 库）
	r.Get("/public/articles", handlePublicArticleList)
	r.Get("/public/articles/:id", handlePublicArticleDetail)
	r.Get("/public/articles/:id/files/:fileId", handlePublicArticleFile)
	r.Head("/public/articles/:id/files/:fileId", handlePublicArticleFile)
	r.Get("/public/site", handlePublicSite)
	r.Get("/public/site/quote", handlePublicQuote)
	r.Head("/public/site/quote", handlePublicQuote)
	r.Get("/public/site/files/:fileId", handlePublicSiteFile)
	r.Head("/public/site/files/:fileId", handlePublicSiteFile)
	r.Get("/public/ssr", handlePublicSSR)
	r.Head("/public/ssr", handlePublicSSR)
	r.Get("/public/ssr/*", handlePublicSSR)
	r.Head("/public/ssr/*", handlePublicSSR)
	r.Get("/public/rss.xml", handlePublicRSS)
	r.Head("/public/rss.xml", handlePublicRSS)
	r.Get("/public/sitemap.xml", handlePublicSitemap)
	r.Head("/public/sitemap.xml", handlePublicSitemap)

	return r
}

func requireUser(c *appkit.Context) (*appkit.User, bool) {
	u := c.User()
	if u == nil || u.ID <= 0 {
		c.Error(http.StatusUnauthorized, "请先登录")
		return nil, false
	}
	return u, true
}

func decodeStrictJSON(c *appkit.Context, dst any, maxBytes int) bool {
	raw, err := c.Body()
	if err != nil {
		articleAPIError(c, errArticleInvalid)
		return false
	}
	if maxBytes > 0 && len(raw) > maxBytes {
		articleAPIError(c, errArticleInvalid)
		return false
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		articleAPIError(c, errArticleInvalid)
		return false
	}
	var trailing any
	if err := dec.Decode(&trailing); err != io.EOF {
		articleAPIError(c, errArticleInvalid)
		return false
	}
	return true
}

func articleAPIError(c *appkit.Context, err error) {
	status, message := http.StatusInternalServerError, "文章操作失败，请重试"
	switch {
	case errors.Is(err, sql.ErrNoRows):
		status, message = http.StatusNotFound, "文章或资源不存在"
	case errors.Is(err, errArticleConflict):
		status, message = http.StatusConflict, "文章已被更新，当前草稿已保留，请重新读取后再保存"
	case errors.Is(err, errArticleInvalid):
		status, message = http.StatusBadRequest, "请检查标题、正文、分类、标签和附件"
	case errors.Is(err, errArticleInUse):
		status, message = http.StatusConflict, "该分类或标签仍被文章使用，请先调整相关文章"
	case errors.Is(err, errArticleDenied):
		status, message = http.StatusForbidden, "无权执行此操作"
	}
	c.Error(status, message)
}

func validArticleText(text string, limit int, multiline bool) bool {
	if !utf8.ValidString(text) || utf8.RuneCountInString(text) > limit {
		return false
	}
	for _, ch := range text {
		if unicode.IsControl(ch) && !(multiline && (ch == '\n' || ch == '\r' || ch == '\t')) {
			return false
		}
	}
	return true
}

func boolInt(v bool) int {
	if v {
		return 1
	}
	return 0
}

func parsePositiveID(raw string) (int64, bool) {
	id, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}

func formatFileID(id int64) string {
	return "file:" + strconv.FormatInt(id, 10)
}

func parseNumericFileID(raw string) (int64, bool) {
	s := strings.TrimSpace(raw)
	if after, ok := strings.CutPrefix(s, "file:"); ok {
		s = after
	} else if after, ok := strings.CutPrefix(s, "article-file:"); ok {
		s = after
	}
	return parsePositiveID(s)
}

//go:wasmexport handle
func handle() int32 {
	return appkit.Dispatch(buildRouter())
}

func main() {}

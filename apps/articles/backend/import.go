package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/xyzphp/desk-store/sdk/appkit"
)

type builtinImportFile struct {
	FileID    string `json:"file_id"`
	Name      string `json:"name"`
	MediaType string `json:"media_type"`
	Size      int64  `json:"size"`
	Width     int    `json:"width,omitempty"`
	Height    int    `json:"height,omitempty"`
}

type builtinImportQuote struct {
	Day       string `json:"day"`
	Text      string `json:"text"`
	Status    string `json:"status"`
	Source    string `json:"source"`
	FetchedAt int64  `json:"fetched_at"`
	UpdatedAt int64  `json:"updated_at"`
}

type builtinArticlesSiteExport struct {
	Configured   bool                 `json:"configured"`
	Config       articleSiteConfig    `json:"config"`
	Revision     int64                `json:"revision"`
	UpdatedAt    int64                `json:"updated_at"`
	Files        []builtinImportFile  `json:"files"`
	Quotes       []builtinImportQuote `json:"quotes"`
	MissingFiles []string             `json:"missing_files,omitempty"`
}

type builtinImportEnvelope struct {
	Source     string                    `json:"source"`
	ExportedAt int64                     `json:"exported_at"`
	Data       builtinArticlesSiteExport `json:"data"`
}

func clearUnavailableSiteImages(cfg *articleSiteConfig, available map[int64]bool) {
	keep := func(id int64) int64 {
		if id > 0 && available[id] {
			return id
		}
		return 0
	}
	cfg.LogoImage = keep(cfg.LogoImage)
	cfg.AvatarImage = keep(cfg.AvatarImage)
	cfg.Banners.Home = keep(cfg.Banners.Home)
	cfg.Banners.Detail = keep(cfg.Banners.Detail)
	cfg.Banners.Archives = keep(cfg.Banners.Archives)
	cfg.Banners.Categories = keep(cfg.Banners.Categories)
	cfg.Banners.Tags = keep(cfg.Banners.Tags)
	cfg.Footer.SubscriptionImage = keep(cfg.Footer.SubscriptionImage)
	cfg.Footer.QRCodeImage = keep(cfg.Footer.QRCodeImage)
	cfg.Footer.BgImage = keep(cfg.Footer.BgImage)
	for i := range cfg.Footer.Columns {
		cfg.Footer.Columns[i].Image = keep(cfg.Footer.Columns[i].Image)
	}
}

func handleBuiltinImport(c *appkit.Context) {
	if c.Entry() != "import" && !c.HasPermission("site.settings") {
		c.Error(http.StatusForbidden, "无权导入内置配置")
		return
	}
	raw, err := c.Body()
	if err != nil || len(raw) == 0 || len(raw) > (1<<20) {
		c.Error(http.StatusBadRequest, "导入数据无效或超过大小限制")
		return
	}
	var env builtinImportEnvelope
	if err := json.Unmarshal(raw, &env); err != nil {
		c.Error(http.StatusBadRequest, "导入数据格式无效")
		return
	}
	if env.Source != "articles.site" {
		c.Error(http.StatusBadRequest, "不支持的导入来源")
		return
	}

	missingSet := map[int64]bool{}
	for _, rawID := range env.Data.MissingFiles {
		if fid, ok := parseNumericFileID(rawID); ok {
			missingSet[fid] = true
		}
	}

	var callerID int64
	if u := c.User(); u != nil {
		callerID = u.ID
	}

	sharedDB := appkit.OpenDB("shared")
	pubDB := appkit.OpenDB("public")
	now := time.Now().UnixMilli()

	available := map[int64]bool{}
	metas := map[int64]articleFileMeta{}
	for _, f := range env.Data.Files {
		fid, ok := parseNumericFileID(f.FileID)
		if !ok || missingSet[fid] {
			continue
		}
		if f.MediaType != "" && !isValidSiteImageType(f.MediaType) {
			continue
		}
		meta := articleFileMeta{
			FileID:    fid,
			UserID:    callerID,
			Name:      strings.TrimSpace(f.Name),
			MediaType: strings.TrimSpace(f.MediaType),
			SizeBytes: f.Size,
			Width:     f.Width,
			Height:    f.Height,
			UpdatedAt: now,
		}
		if meta.MediaType == "" {
			meta.MediaType = "image/png"
		}
		if existingMeta, err := loadFileMeta(sharedDB, fid); err == nil && existingMeta.UserID > 0 {
			meta.UserID = existingMeta.UserID
		}
		if err := upsertFileMeta(sharedDB, meta); err != nil {
			articleAPIError(c, err)
			return
		}
		available[fid] = true
		metas[fid] = meta
	}

	cfg := env.Data.Config
	normalizeArticleBanners(&cfg.Banners)
	normalizeArticleFooter(&cfg.Footer)
	clearUnavailableSiteImages(&cfg, available)
	if strings.TrimSpace(cfg.Name) == "" {
		cfg.Name = defaultArticleSiteConfig().Name
	}
	if err := validateArticleSiteConfig(&cfg); err != nil {
		c.Error(http.StatusBadRequest, "导入的站点配置校验未通过，请检查字段格式")
		return
	}

	if _, err := sharedDB.Exec(`INSERT OR IGNORE INTO article_site_settings(id, config_json, revision, updated_at) VALUES(1, '{}', 0, 0)`); err != nil {
		articleAPIError(c, err)
		return
	}
	current, err := loadArticleSite(sharedDB)
	if err != nil {
		articleAPIError(c, err)
		return
	}
	prevSiteFiles, _ := listSiteFileIDs(sharedDB)

	nextRev := current.Revision + 1
	if env.Data.Revision >= nextRev {
		nextRev = env.Data.Revision
	}
	if nextRev <= 0 {
		nextRev = 1
	}
	updatedAt := env.Data.UpdatedAt
	if updatedAt <= 0 {
		updatedAt = now
	}
	cfgRaw, err := json.Marshal(cfg)
	if err != nil {
		articleAPIError(c, err)
		return
	}
	if _, err := sharedDB.Exec(
		`UPDATE article_site_settings SET config_json = ?, revision = ?, updated_at = ? WHERE id = 1`,
		string(cfgRaw), nextRev, updatedAt,
	); err != nil {
		articleAPIError(c, err)
		return
	}

	imageIDs := articleSiteImageIDs(cfg)
	imageSet := map[int64]bool{}
	if _, err := sharedDB.Exec(`DELETE FROM article_site_files WHERE site_id = 1`); err != nil {
		articleAPIError(c, err)
		return
	}
	for _, id := range imageIDs {
		imageSet[id] = true
		if _, err := sharedDB.Exec(`INSERT INTO article_site_files(site_id, file_id) VALUES(1, ?)`, id); err != nil {
			articleAPIError(c, err)
			return
		}
	}
	// 清理先前版本站点设置引用但本次覆盖后不再使用的图片引用
	for _, oldID := range prevSiteFiles {
		if !imageSet[oldID] {
			fidStr := formatFileID(oldID)
			_ = appkit.FileReferenceRemove(fidStr, siteFileRefKey)
			_ = appkit.FileReferenceRemove(fidStr, builtinSiteFileRefKey)
		}
	}

	siteRecord := articleSiteRecord{
		Config:    cfg,
		Revision:  nextRev,
		UpdatedAt: updatedAt,
	}
	if err := syncPublicSiteProjection(pubDB, siteRecord, metas); err != nil {
		articleAPIError(c, err)
		return
	}

	importedQuotes := 0
	for _, q := range env.Data.Quotes {
		day := strings.TrimSpace(q.Day)
		text := strings.TrimSpace(q.Text)
		if !validArticleQuoteDay(day) || text == "" || !validArticleText(text, 240, false) {
			continue
		}
		source := q.Source
		if source != "api" && source != "manual" {
			source = "manual"
		}
		fetchedAt := q.FetchedAt
		if fetchedAt <= 0 {
			fetchedAt = now
		}
		qUpdated := q.UpdatedAt
		if qUpdated <= 0 {
			qUpdated = fetchedAt
		}
		var rev int64 = 1
		if existingQ, err := scanArticleQuote(sharedDB.QueryRow(`SELECT `+articleQuoteColumns+` FROM article_site_quotes WHERE quote_day = ?`, day)); err == nil {
			rev = existingQ.Revision + 1
		}
		if _, err := sharedDB.Exec(
			`INSERT INTO article_site_quotes(quote_day, quote_text, status, source, revision, fetched_at, updated_at)
			 VALUES(?, ?, 'ready', ?, ?, ?, ?)
			 ON CONFLICT(quote_day) DO UPDATE SET
			   quote_text = excluded.quote_text,
			   status = excluded.status,
			   source = excluded.source,
			   revision = excluded.revision,
			   fetched_at = excluded.fetched_at,
			   updated_at = excluded.updated_at`,
			day, text, source, rev, fetchedAt, qUpdated,
		); err != nil {
			articleAPIError(c, err)
			return
		}
		if err := syncPublicQuote(pubDB, day, text); err != nil {
			articleAPIError(c, err)
			return
		}
		importedQuotes++
	}

	c.JSON(http.StatusOK, map[string]any{
		"ok": true,
		"imported": map[string]any{
			"configured":   env.Data.Configured,
			"images":       len(imageIDs),
			"quotes":       importedQuotes,
			"missingFiles": len(env.Data.MissingFiles),
			"revision":     siteRecord.Revision,
		},
	})
}

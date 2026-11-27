package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/xyzphp/desk-store/sdk/appkit"
)

const (
	siteFileRefKey        = "site:image"
	builtinSiteFileRefKey = "builtin:articles.site"
)

type articleSiteLink struct {
	Label string `json:"label"`
	URL   string `json:"url"`
}

func boolPtr(v bool) *bool {
	return &v
}

type articleSiteBanners struct {
	Enabled           *bool `json:"enabled"`
	AvatarEnabled     *bool `json:"avatarEnabled,omitempty"`
	Home              int64 `json:"home"`
	Detail            int64 `json:"detail"`
	Archives          int64 `json:"archives"`
	Categories        int64 `json:"categories"`
	Tags              int64 `json:"tags"`
	HomeEnabled       *bool `json:"homeEnabled"`
	DetailEnabled     *bool `json:"detailEnabled"`
	ArchivesEnabled   *bool `json:"archivesEnabled"`
	CategoriesEnabled *bool `json:"categoriesEnabled"`
	TagsEnabled       *bool `json:"tagsEnabled"`
}

type articleSiteKV struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

type articleSiteFooterItem struct {
	Text    string `json:"text"`
	URL     string `json:"url"`
	Newline bool   `json:"newline"`
}

type articleFooterColumn struct {
	Enabled *bool             `json:"enabled"`
	Type    string            `json:"type"` // "links", "text", "image", "keyvalue"
	Title   string            `json:"title"`
	Image   int64             `json:"image,omitempty"`
	Text    string            `json:"text,omitempty"`
	Links   []articleSiteLink `json:"links,omitempty"`
	Items   []articleSiteKV   `json:"items,omitempty"`
}

type articleSiteFooter struct {
	Enabled           *bool                   `json:"enabled"`
	SubscriptionTitle string                  `json:"subscriptionTitle"`
	SubscriptionImage int64                   `json:"subscriptionImage"`
	ContactTitle      string                  `json:"contactTitle"`
	Contacts          []articleSiteLink       `json:"contacts"`
	FriendsTitle      string                  `json:"friendsTitle"`
	Friends           []articleSiteLink       `json:"friends"`
	QRCodeTitle       string                  `json:"qrCodeTitle"`
	QRCodeImage       int64                   `json:"qrCodeImage"`
	Columns           []articleFooterColumn   `json:"columns"`
	Items             []articleSiteFooterItem `json:"items"`
	BgColor           string                  `json:"bgColor,omitempty"`
	TextColor         string                  `json:"textColor,omitempty"`
	BgImage           int64                   `json:"bgImage,omitempty"`
	BgImageUrl        string                  `json:"bgImageUrl,omitempty"`
	BgMode            string                  `json:"bgMode,omitempty"`
	BgOverlay         string                  `json:"bgOverlay,omitempty"`
	BorderStyle       string                  `json:"borderStyle,omitempty"`
	Align             string                  `json:"align,omitempty"`
	ShowPoweredBy     *bool                   `json:"showPoweredBy,omitempty"`
	Copyright         string                  `json:"copyright"`
	RecordLabel       string                  `json:"recordLabel"`
	RecordURL         string                  `json:"recordUrl"`
}

type articleSiteConfig struct {
	Name        string             `json:"name"`
	Title       string             `json:"title"`
	Description string             `json:"description"`
	Quote       articleQuoteConfig `json:"quote"`
	LogoImage   int64              `json:"logoImage"`
	AvatarImage int64              `json:"avatarImage"`
	Banners     articleSiteBanners `json:"banners"`
	Footer      articleSiteFooter  `json:"footer"`
}

type articleSiteRecord struct {
	Config    articleSiteConfig `json:"config"`
	Revision  int64             `json:"revision"`
	UpdatedAt int64             `json:"updatedAt"`
}

func normalizeArticleBanners(banners *articleSiteBanners) {
	if banners.Enabled == nil {
		banners.Enabled = boolPtr(true)
	}
	if banners.AvatarEnabled == nil {
		banners.AvatarEnabled = boolPtr(true)
	}
	if banners.HomeEnabled == nil {
		banners.HomeEnabled = boolPtr(true)
	}
	if banners.DetailEnabled == nil {
		banners.DetailEnabled = boolPtr(true)
	}
	if banners.ArchivesEnabled == nil {
		banners.ArchivesEnabled = boolPtr(true)
	}
	if banners.CategoriesEnabled == nil {
		banners.CategoriesEnabled = boolPtr(true)
	}
	if banners.TagsEnabled == nil {
		banners.TagsEnabled = boolPtr(true)
	}
}

func normalizeArticleFooter(footer *articleSiteFooter) {
	if footer.Enabled == nil {
		footer.Enabled = boolPtr(true)
	}
	if len(footer.Columns) == 0 {
		cols := []articleFooterColumn{}
		if footer.SubscriptionTitle != "" || footer.SubscriptionImage != 0 {
			cols = append(cols, articleFooterColumn{Enabled: boolPtr(true), Type: "image", Title: footer.SubscriptionTitle, Image: footer.SubscriptionImage})
		}
		if footer.ContactTitle != "" || len(footer.Contacts) > 0 {
			cols = append(cols, articleFooterColumn{Enabled: boolPtr(true), Type: "links", Title: footer.ContactTitle, Links: footer.Contacts})
		}
		if footer.FriendsTitle != "" || len(footer.Friends) > 0 {
			cols = append(cols, articleFooterColumn{Enabled: boolPtr(true), Type: "links", Title: footer.FriendsTitle, Links: footer.Friends})
		}
		if footer.QRCodeTitle != "" || footer.QRCodeImage != 0 {
			cols = append(cols, articleFooterColumn{Enabled: boolPtr(true), Type: "image", Title: footer.QRCodeTitle, Image: footer.QRCodeImage})
		}
		if len(cols) == 0 {
			cols = []articleFooterColumn{
				{Enabled: boolPtr(true), Type: "image", Title: "我的订阅号"},
				{Enabled: boolPtr(true), Type: "links", Title: "联系方式", Links: []articleSiteLink{}},
				{Enabled: boolPtr(true), Type: "links", Title: "友情链接", Links: []articleSiteLink{}},
				{Enabled: boolPtr(true), Type: "image", Title: "我的微信号"},
			}
		}
		footer.Columns = cols
	}
	for i := range footer.Columns {
		if footer.Columns[i].Enabled == nil {
			footer.Columns[i].Enabled = boolPtr(true)
		}
		if footer.Columns[i].Links == nil {
			footer.Columns[i].Links = []articleSiteLink{}
		}
		if footer.Columns[i].Items == nil {
			footer.Columns[i].Items = []articleSiteKV{}
		}
	}
	if footer.BgMode == "" {
		footer.BgMode = "repeat"
	}
	if footer.BgOverlay == "" {
		footer.BgOverlay = "0"
	}
	if footer.BorderStyle == "" {
		footer.BorderStyle = "solid"
	}
	if footer.Align == "" {
		footer.Align = "center"
	}
	if footer.ShowPoweredBy == nil {
		footer.ShowPoweredBy = boolPtr(true)
	}
	if footer.Items == nil {
		footer.Items = []articleSiteFooterItem{}
	}
	if footer.Contacts == nil {
		footer.Contacts = []articleSiteLink{}
	}
	if footer.Friends == nil {
		footer.Friends = []articleSiteLink{}
	}
}

func defaultArticleSiteConfig() articleSiteConfig {
	return articleSiteConfig{
		Name:        "文章",
		Title:       "文章",
		Description: "记录、整理与分享",
		Quote: articleQuoteConfig{
			Mode:   "manual",
			URL:    "https://v1.hitokoto.cn/?encode=json",
			Format: "json",
			Field:  "hitokoto",
		},
		Banners: articleSiteBanners{
			Enabled:           boolPtr(true),
			AvatarEnabled:     boolPtr(true),
			HomeEnabled:       boolPtr(true),
			DetailEnabled:     boolPtr(true),
			ArchivesEnabled:   boolPtr(true),
			CategoriesEnabled: boolPtr(true),
			TagsEnabled:       boolPtr(true),
		},
		Footer: articleSiteFooter{
			Enabled:           boolPtr(true),
			BgMode:            "repeat",
			BgOverlay:         "0",
			BorderStyle:       "solid",
			Align:             "center",
			ShowPoweredBy:     boolPtr(true),
			Items:             []articleSiteFooterItem{},
			SubscriptionTitle: "我的订阅号",
			ContactTitle:      "联系方式",
			FriendsTitle:      "友情链接",
			QRCodeTitle:       "我的微信号",
			Copyright:         "© 文章",
			Contacts:          []articleSiteLink{},
			Friends:           []articleSiteLink{},
			Columns: []articleFooterColumn{
				{Enabled: boolPtr(true), Type: "image", Title: "我的订阅号"},
				{Enabled: boolPtr(true), Type: "links", Title: "联系方式", Links: []articleSiteLink{}},
				{Enabled: boolPtr(true), Type: "links", Title: "友情链接", Links: []articleSiteLink{}},
				{Enabled: boolPtr(true), Type: "image", Title: "我的微信号"},
			},
		},
	}
}

func parseArticleSiteConfig(raw string) (articleSiteConfig, error) {
	cfg := defaultArticleSiteConfig()
	cfg.Banners.Enabled = nil
	cfg.Banners.AvatarEnabled = nil
	cfg.Banners.HomeEnabled = nil
	cfg.Banners.DetailEnabled = nil
	cfg.Banners.ArchivesEnabled = nil
	cfg.Banners.CategoriesEnabled = nil
	cfg.Banners.TagsEnabled = nil
	cfg.Footer.Enabled = nil
	if strings.TrimSpace(raw) != "" && strings.TrimSpace(raw) != "{}" {
		if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
			return cfg, err
		}
	}
	normalizeArticleBanners(&cfg.Banners)
	normalizeArticleFooter(&cfg.Footer)
	return cfg, nil
}

func loadArticleSiteFromTable(db *sql.DB, table string) (articleSiteRecord, error) {
	site := articleSiteRecord{Config: defaultArticleSiteConfig()}
	var raw string
	err := db.QueryRow(`SELECT config_json, revision, updated_at FROM `+table+` WHERE id = 1`).Scan(&raw, &site.Revision, &site.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return site, nil
	}
	if err != nil {
		return site, err
	}
	cfg, err := parseArticleSiteConfig(raw)
	if err != nil {
		return site, err
	}
	site.Config = cfg
	return site, nil
}

func loadArticleSite(sharedDB *sql.DB) (articleSiteRecord, error) {
	return loadArticleSiteFromTable(sharedDB, "article_site_settings")
}

func loadPublicArticleSite(pubDB *sql.DB) (articleSiteRecord, error) {
	site, err := loadArticleSiteFromTable(pubDB, "public_site_settings")
	if err != nil {
		return site, err
	}
	site.Config = publicArticleSiteConfig(site.Config)
	return site, nil
}

func articleSiteImageIDs(config articleSiteConfig) []int64 {
	seen := map[int64]bool{}
	for _, id := range []int64{
		config.LogoImage, config.AvatarImage,
		config.Banners.Home, config.Banners.Detail, config.Banners.Archives, config.Banners.Categories, config.Banners.Tags,
		config.Footer.SubscriptionImage, config.Footer.QRCodeImage, config.Footer.BgImage,
	} {
		if id != 0 {
			seen[id] = true
		}
	}
	for _, col := range config.Footer.Columns {
		if col.Image > 0 {
			seen[col.Image] = true
		}
	}
	ids := make([]int64, 0, len(seen))
	for id := range seen {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	return ids
}

func validArticleSiteURL(raw string) bool {
	if raw == "" {
		return true
	}
	if !validArticleText(raw, 500, false) || strings.ContainsAny(raw, "\\\"<> ") {
		return false
	}
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Hostname() != "" && u.User == nil && u.Opaque == ""
}

func validArticleColor(c string) bool {
	if c == "" {
		return true
	}
	if len(c) > 40 {
		return false
	}
	for _, r := range c {
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '#' && r != '-' && r != '_' && r != '(' && r != ')' && r != ',' && r != '%' && r != ' ' {
			return false
		}
	}
	return true
}

func validateArticleSiteConfig(config *articleSiteConfig) error {
	normalizeArticleBanners(&config.Banners)
	normalizeArticleFooter(&config.Footer)
	config.Name = strings.TrimSpace(config.Name)
	if config.Name == "" || !validArticleText(config.Name, 60, false) || !validArticleText(config.Title, 80, false) || !validArticleText(config.Description, 240, false) {
		return errArticleInvalid
	}
	if err := validateArticleQuote(&config.Quote); err != nil {
		return err
	}
	footer := &config.Footer
	for _, text := range []string{footer.SubscriptionTitle, footer.ContactTitle, footer.FriendsTitle, footer.QRCodeTitle} {
		if !validArticleText(text, 60, false) {
			return errArticleInvalid
		}
	}
	if !validArticleText(footer.Copyright, 240, false) || !validArticleText(footer.RecordLabel, 100, false) || !validArticleSiteURL(footer.RecordURL) || len(footer.Contacts) > 8 || len(footer.Friends) > 16 {
		return errArticleInvalid
	}
	if len(footer.Items) > 16 {
		return errArticleInvalid
	}
	for _, item := range footer.Items {
		if !validArticleText(item.Text, 240, false) || !validArticleSiteURL(item.URL) {
			return errArticleInvalid
		}
	}
	for _, link := range append(append([]articleSiteLink{}, footer.Contacts...), footer.Friends...) {
		if strings.TrimSpace(link.Label) == "" || !validArticleText(link.Label, 100, false) || !validArticleSiteURL(link.URL) {
			return errArticleInvalid
		}
	}
	if len(footer.Columns) > 8 {
		return errArticleInvalid
	}
	for _, col := range footer.Columns {
		if col.Type != "" && col.Type != "links" && col.Type != "text" && col.Type != "image" && col.Type != "keyvalue" {
			return errArticleInvalid
		}
		if !validArticleText(col.Title, 60, false) {
			return errArticleInvalid
		}
		if col.Type == "text" && !validArticleText(col.Text, 500, true) {
			return errArticleInvalid
		}
		if col.Type == "image" && col.Image < 0 {
			return errArticleInvalid
		}
		if col.Type == "links" {
			if len(col.Links) > 16 {
				return errArticleInvalid
			}
			for _, link := range col.Links {
				if strings.TrimSpace(link.Label) == "" || !validArticleText(link.Label, 100, false) || !validArticleSiteURL(link.URL) {
					return errArticleInvalid
				}
			}
		}
		if col.Type == "keyvalue" {
			if len(col.Items) > 16 {
				return errArticleInvalid
			}
			for _, item := range col.Items {
				if strings.TrimSpace(item.Key) == "" || !validArticleText(item.Key, 60, false) || !validArticleText(item.Value, 200, false) {
					return errArticleInvalid
				}
			}
		}
	}
	if !validArticleColor(footer.BgColor) || !validArticleColor(footer.TextColor) {
		return errArticleInvalid
	}
	if footer.BgMode != "" && footer.BgMode != "repeat" && footer.BgMode != "cover" && footer.BgMode != "contain" && footer.BgMode != "center" && footer.BgMode != "none" {
		return errArticleInvalid
	}
	if footer.BgOverlay != "" {
		if val, err := strconv.ParseFloat(footer.BgOverlay, 64); err != nil || val < 0 || val > 1 {
			return errArticleInvalid
		}
	}
	if footer.BorderStyle != "" && footer.BorderStyle != "solid" && footer.BorderStyle != "gradient" && footer.BorderStyle != "dashed" && footer.BorderStyle != "none" {
		return errArticleInvalid
	}
	if footer.Align != "" && footer.Align != "center" && footer.Align != "split" {
		return errArticleInvalid
	}
	if !validArticleSiteURL(footer.BgImageUrl) {
		return errArticleInvalid
	}
	if footer.BgImage < 0 {
		return errArticleInvalid
	}
	for _, id := range articleSiteImageIDs(*config) {
		if id < 0 {
			return errArticleInvalid
		}
	}
	if footer.Contacts == nil {
		footer.Contacts = []articleSiteLink{}
	}
	if footer.Friends == nil {
		footer.Friends = []articleSiteLink{}
	}
	return nil
}

func isValidSiteImageType(mediaType string) bool {
	return mediaType == "image/png" || mediaType == "image/jpeg"
}

func syncPublicSiteProjection(pubDB *sql.DB, site articleSiteRecord, metas map[int64]articleFileMeta) error {
	pubCfg := publicArticleSiteConfig(site.Config)
	raw, err := json.Marshal(pubCfg)
	if err != nil {
		return err
	}
	if _, err := pubDB.Exec(
		`INSERT INTO public_site_settings(id, config_json, revision, updated_at) VALUES(1, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, revision = excluded.revision, updated_at = excluded.updated_at`,
		string(raw), site.Revision, site.UpdatedAt,
	); err != nil {
		return err
	}
	if _, err := pubDB.Exec(`DELETE FROM public_site_files`); err != nil {
		return err
	}
	for _, id := range articleSiteImageIDs(site.Config) {
		meta := metas[id]
		mediaType := meta.MediaType
		if !isValidSiteImageType(mediaType) {
			mediaType = "image/png"
		}
		if _, err := pubDB.Exec(
			`INSERT INTO public_site_files(file_id, name, media_type, width, height) VALUES(?, ?, ?, ?, ?)
			 ON CONFLICT(file_id) DO UPDATE SET name = excluded.name, media_type = excluded.media_type, width = excluded.width, height = excluded.height`,
			id, meta.Name, mediaType, meta.Width, meta.Height,
		); err != nil {
			return err
		}
	}
	return nil
}

func listSiteFileIDs(sharedDB *sql.DB) ([]int64, error) {
	rows, err := sharedDB.Query(`SELECT file_id FROM article_site_files WHERE site_id = 1`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []int64{}
	for rows.Next() {
		var fid int64
		if err := rows.Scan(&fid); err != nil {
			return nil, err
		}
		ids = append(ids, fid)
	}
	return ids, rows.Err()
}

func handleGetSite(c *appkit.Context) {
	if _, ok := requireUser(c); !ok {
		return
	}
	if !c.HasPermission("site.settings") {
		c.Error(http.StatusForbidden, "只有拥有站点设置权限的成员可以配置文章站点")
		return
	}
	site, err := loadArticleSite(appkit.OpenDB("shared"))
	if err != nil {
		articleAPIError(c, err)
		return
	}
	c.JSON(http.StatusOK, map[string]any{"ok": true, "site": site})
}

func handlePutSite(c *appkit.Context) {
	user, ok := requireUser(c)
	if !ok {
		return
	}
	if !c.HasPermission("site.settings") {
		c.Error(http.StatusForbidden, "只有拥有站点设置权限的成员可以配置文章站点")
		return
	}
	var req articleSiteRecord
	if !decodeStrictJSON(c, &req, 128<<10) {
		return
	}
	if err := validateArticleSiteConfig(&req.Config); err != nil {
		c.Error(http.StatusBadRequest, "请检查站点名称、图片、文案接口、页脚内容及链接地址")
		return
	}
	sharedDB := appkit.OpenDB("shared")
	pubDB := appkit.OpenDB("public")
	site, err := saveArticleSite(sharedDB, pubDB, user.ID, req)
	if err != nil {
		if errors.Is(err, errArticleConflict) {
			c.Error(http.StatusConflict, "站点设置已被其他管理员更新，请重新读取后再保存")
		} else if errors.Is(err, errArticleInvalid) {
			c.Error(http.StatusBadRequest, "请检查站点名称、图片、文案接口、页脚内容及链接地址")
		} else {
			articleAPIError(c, err)
		}
		return
	}
	c.JSON(http.StatusOK, map[string]any{"ok": true, "site": site})
}

func saveArticleSite(sharedDB, pubDB *sql.DB, owner int64, req articleSiteRecord) (articleSiteRecord, error) {
	if _, err := sharedDB.Exec(`INSERT OR IGNORE INTO article_site_settings(id, config_json, revision, updated_at) VALUES(1, '{}', 0, 0)`); err != nil {
		return req, err
	}
	current, err := loadArticleSite(sharedDB)
	if err != nil {
		return req, err
	}
	if req.Revision != current.Revision {
		return req, errArticleConflict
	}

	existing := map[int64]bool{}
	for _, id := range articleSiteImageIDs(current.Config) {
		existing[id] = true
	}
	if prevIDs, err := listSiteFileIDs(sharedDB); err == nil {
		for _, id := range prevIDs {
			existing[id] = true
		}
	}

	ids := articleSiteImageIDs(req.Config)
	idSet := map[int64]bool{}
	metas := map[int64]articleFileMeta{}
	for _, id := range ids {
		idSet[id] = true
		var meta articleFileMeta
		if existing[id] {
			m, err := loadFileMeta(sharedDB, id)
			if err == nil && isValidSiteImageType(m.MediaType) {
				meta = m
			}
			if ref, rErr := appkit.FileReferenceRead(formatFileID(id), true); rErr == nil {
				if !isValidSiteImageType(ref.MediaType) {
					return req, errArticleInvalid
				}
				meta.FileID = id
				if ref.Name != "" {
					meta.Name = ref.Name
				}
				meta.MediaType = ref.MediaType
				if ref.Size > 0 {
					meta.SizeBytes = ref.Size
				}
				if ref.Width > 0 {
					meta.Width = ref.Width
				}
				if ref.Height > 0 {
					meta.Height = ref.Height
				}
			} else if !isValidSiteImageType(meta.MediaType) {
				return req, errArticleInvalid
			}
		} else {
			m, err := ensureOwnedFileMeta(sharedDB, owner, id)
			if err != nil || !isValidSiteImageType(m.MediaType) {
				return req, errArticleInvalid
			}
			meta = m
		}
		metas[id] = meta
	}

	raw, err := json.Marshal(req.Config)
	if err != nil {
		return req, err
	}
	req.Revision = current.Revision + 1
	req.UpdatedAt = time.Now().UnixMilli()

	res, err := sharedDB.Exec(
		`UPDATE article_site_settings SET config_json = ?, revision = ?, updated_at = ? WHERE id = 1 AND revision = ?`,
		string(raw), req.Revision, req.UpdatedAt, current.Revision,
	)
	if err != nil {
		return req, err
	}
	if n, err := res.RowsAffected(); err != nil || n == 0 {
		if err != nil {
			return req, err
		}
		return req, errArticleConflict
	}

	if _, err := sharedDB.Exec(`DELETE FROM article_site_files WHERE site_id = 1`); err != nil {
		return req, err
	}
	for _, id := range ids {
		if _, err := sharedDB.Exec(`INSERT INTO article_site_files(site_id, file_id) VALUES(1, ?)`, id); err != nil {
			return req, err
		}
		fidStr := formatFileID(id)
		_ = appkit.FileReferenceAdd(fidStr, siteFileRefKey)
		_ = appkit.FileReferenceRemove(fidStr, tempFileRefKey)
	}
	for oldID := range existing {
		if !idSet[oldID] {
			fidStr := formatFileID(oldID)
			_ = appkit.FileReferenceRemove(fidStr, siteFileRefKey)
			_ = appkit.FileReferenceRemove(fidStr, builtinSiteFileRefKey)
			_ = appkit.FileReferenceRemove(fidStr, tempFileRefKey)
		}
	}

	if err := syncPublicSiteProjection(pubDB, req, metas); err != nil {
		return req, err
	}
	return req, nil
}

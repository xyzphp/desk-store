package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"html"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/xyzphp/desk-store/sdk/appkit"
)

type publicArticleRow struct {
	ID           int64
	UserID       int64
	AuthorName   string
	PublishedRaw string
	Published    articleDraft
	Visibility   string
	PublishedAt  int64
	CoverFileID  int64
	CoverWidth   int
	CoverHeight  int
}

type publicTaxonomyItem struct {
	ID       int64  `json:"id"`
	Kind     string `json:"kind"`
	Name     string `json:"name"`
	ParentID int64  `json:"parentId"`
	Revision int64  `json:"revision"`
	Count    int64  `json:"count"`
}

type publicArchiveItem struct {
	Month string `json:"month"`
	Count int64  `json:"count"`
}

type publicArticleFileItem struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Size      int64  `json:"size"`
	MediaType string `json:"mediaType"`
}

var utcPlus8 = time.FixedZone("UTC+8", 8*60*60)

func scanPublicArticle(row rowScanner) (publicArticleRow, error) {
	var rec publicArticleRow
	if err := row.Scan(
		&rec.ID, &rec.UserID, &rec.AuthorName, &rec.PublishedRaw,
		&rec.Visibility, &rec.PublishedAt, &rec.CoverFileID, &rec.CoverWidth, &rec.CoverHeight,
	); err != nil {
		return rec, err
	}
	if err := json.Unmarshal([]byte(rec.PublishedRaw), &rec.Published); err != nil {
		return rec, err
	}
	if rec.Published.TagIDs == nil {
		rec.Published.TagIDs = []int64{}
	}
	if rec.Published.FileIDs == nil {
		rec.Published.FileIDs = []int64{}
	}
	if strings.TrimSpace(rec.AuthorName) == "" {
		rec.AuthorName = "作者"
	}
	return rec, nil
}

func loadVisiblePublicArticles(pubDB *sql.DB, viewer *appkit.User) ([]publicArticleRow, error) {
	rows, err := pubDB.Query(
		`SELECT id, user_id, author_name, published_json, visibility, published_at, cover_file_id, cover_width, cover_height
		 FROM public_articles ORDER BY published_at DESC, id DESC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	viewerID := int64(0)
	if viewer != nil && viewer.ID > 0 {
		viewerID = viewer.ID
	}
	items := []publicArticleRow{}
	for rows.Next() {
		rec, err := scanPublicArticle(rows)
		if err != nil {
			return nil, err
		}
		if rec.PublishedAt <= 0 {
			continue
		}
		if rec.Visibility == "public" || (viewerID > 0 && rec.Visibility == "private" && rec.UserID == viewerID) {
			items = append(items, rec)
		}
	}
	return items, rows.Err()
}

func readablePublicArticle(pubDB *sql.DB, viewer *appkit.User, id int64) (publicArticleRow, error) {
	rec, err := scanPublicArticle(pubDB.QueryRow(
		`SELECT id, user_id, author_name, published_json, visibility, published_at, cover_file_id, cover_width, cover_height
		 FROM public_articles WHERE id = ?`,
		id,
	))
	if err != nil {
		return publicArticleRow{}, err
	}
	if rec.PublishedAt <= 0 {
		return publicArticleRow{}, sql.ErrNoRows
	}
	if rec.Visibility == "public" {
		return rec, nil
	}
	if viewer == nil || viewer.ID <= 0 || viewer.ID != rec.UserID {
		return publicArticleRow{}, sql.ErrNoRows
	}
	return rec, nil
}

func loadAllPublicTaxonomies(pubDB *sql.DB) (map[int64]articleTaxonomy, error) {
	rows, err := pubDB.Query(`SELECT id, kind, name, parent_id, revision FROM public_taxonomies ORDER BY kind, id LIMIT 2000`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]articleTaxonomy{}
	for rows.Next() {
		var t articleTaxonomy
		if err := rows.Scan(&t.ID, &t.Kind, &t.Name, &t.ParentID, &t.Revision); err != nil {
			return nil, err
		}
		out[t.ID] = t
	}
	return out, rows.Err()
}

func loadPublicArticleTaxMap(pubDB *sql.DB) (map[int64][]int64, error) {
	rows, err := pubDB.Query(`SELECT article_id, taxonomy_id FROM public_article_taxonomies`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64][]int64{}
	for rows.Next() {
		var aid, tid int64
		if err := rows.Scan(&aid, &tid); err != nil {
			return nil, err
		}
		out[aid] = append(out[aid], tid)
	}
	return out, rows.Err()
}

func taxonomyDescendantSet(taxByID map[int64]articleTaxonomy, rootID int64) map[int64]bool {
	set := map[int64]bool{rootID: true}
	changed := true
	for changed {
		changed = false
		for id, t := range taxByID {
			if !set[id] && t.ParentID != 0 && set[t.ParentID] {
				set[id] = true
				changed = true
			}
		}
	}
	return set
}

func handlePublicArticleList(c *appkit.Context) {
	q := strings.TrimSpace(c.Query().Get("q"))
	page, _ := strconv.Atoi(c.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	taxonomy, _ := strconv.ParseInt(c.Query().Get("taxonomy"), 10, 64)
	month := strings.TrimSpace(c.Query().Get("month"))
	var (
		monthStart time.Time
		monthEnd   time.Time
	)
	if !validArticleText(q, 100, false) || page > 10000 || taxonomy < 0 {
		articleAPIError(c, errArticleInvalid)
		return
	}
	if month != "" {
		parsed, err := time.ParseInLocation("2006-01", month, utcPlus8)
		if err != nil || parsed.Year() < 1970 || parsed.Year() > 9998 || parsed.Format("2006-01") != month {
			articleAPIError(c, errArticleInvalid)
			return
		}
		monthStart = parsed
		monthEnd = parsed.AddDate(0, 1, 0)
	}

	pubDB := appkit.OpenDB("public")
	viewer := c.User()
	privateAccess := viewer != nil && viewer.ID > 0
	viewerID := int64(0)
	if privateAccess {
		viewerID = viewer.ID
	}

	visible, err := loadVisiblePublicArticles(pubDB, viewer)
	if err != nil {
		articleAPIError(c, err)
		return
	}
	taxByID, err := loadAllPublicTaxonomies(pubDB)
	if err != nil {
		articleAPIError(c, err)
		return
	}
	artTaxMap, err := loadPublicArticleTaxMap(pubDB)
	if err != nil {
		articleAPIError(c, err)
		return
	}

	// 计算可见文章范围内的分类/标签计数与按月归档计数
	taxCounts := map[int64]int64{}
	archiveCounts := map[string]int64{}
	for _, rec := range visible {
		mKey := time.UnixMilli(rec.PublishedAt).In(utcPlus8).Format("2006-01")
		archiveCounts[mKey]++
		seen := map[int64]bool{}
		for _, tid := range artTaxMap[rec.ID] {
			if !seen[tid] {
				seen[tid] = true
				taxCounts[tid]++
			}
		}
	}
	// 补齐已使用子分类的上级分类节点（计数 0），保障三级分类树结构完整
	includedTax := map[int64]bool{}
	for tid := range taxCounts {
		curr := tid
		visited := map[int64]bool{}
		for curr != 0 && !visited[curr] {
			visited[curr] = true
			if t, ok := taxByID[curr]; ok {
				includedTax[t.ID] = true
				curr = t.ParentID
			} else {
				break
			}
		}
	}
	taxonomies := make([]publicTaxonomyItem, 0, len(includedTax))
	for tid := range includedTax {
		t := taxByID[tid]
		taxonomies = append(taxonomies, publicTaxonomyItem{
			ID:       t.ID,
			Kind:     t.Kind,
			Name:     t.Name,
			ParentID: t.ParentID,
			Revision: t.Revision,
			Count:    taxCounts[tid],
		})
	}
	sort.Slice(taxonomies, func(i, j int) bool {
		if taxonomies[i].Kind != taxonomies[j].Kind {
			return taxonomies[i].Kind < taxonomies[j].Kind
		}
		return taxonomies[i].ID < taxonomies[j].ID
	})
	if len(taxonomies) > 1000 {
		taxonomies = taxonomies[:1000]
	}

	archives := make([]publicArchiveItem, 0, len(archiveCounts))
	for m, cnt := range archiveCounts {
		archives = append(archives, publicArchiveItem{Month: m, Count: cnt})
	}
	sort.Slice(archives, func(i, j int) bool { return archives[i].Month > archives[j].Month })

	// 过滤列表
	lowerQ := strings.ToLower(q)
	var allowedTax map[int64]bool
	if taxonomy > 0 {
		allowedTax = taxonomyDescendantSet(taxByID, taxonomy)
	}
	filtered := make([]publicArticleRow, 0, len(visible))
	for _, rec := range visible {
		if lowerQ != "" && !strings.Contains(strings.ToLower(rec.PublishedRaw), lowerQ) {
			continue
		}
		if taxonomy > 0 {
			matched := false
			for _, tid := range artTaxMap[rec.ID] {
				if allowedTax[tid] {
					matched = true
					break
				}
			}
			if !matched {
				continue
			}
		}
		if month != "" {
			if rec.PublishedAt < monthStart.UnixMilli() || rec.PublishedAt >= monthEnd.UnixMilli() {
				continue
			}
		}
		filtered = append(filtered, rec)
	}

	total := int64(len(filtered))
	offset := (page - 1) * 20
	var pageRows []publicArticleRow
	more := false
	if offset < len(filtered) {
		end := offset + 20
		if end < len(filtered) {
			more = true
		} else {
			end = len(filtered)
		}
		pageRows = filtered[offset:end]
	}

	items := make([]map[string]any, 0, len(pageRows))
	for _, rec := range pageRows {
		item := map[string]any{
			"id":          rec.ID,
			"title":       rec.Published.Title,
			"summary":     rec.Published.Summary,
			"publishedAt": rec.PublishedAt,
			"author":      rec.AuthorName,
			"categoryId":  rec.Published.CategoryID,
			"tagIds":      rec.Published.TagIDs,
			"visibility":  rec.Visibility,
		}
		if rec.CoverFileID > 0 {
			item["coverFileId"] = rec.CoverFileID
			if rec.CoverWidth > 0 && rec.CoverHeight > 0 {
				item["coverWidth"] = rec.CoverWidth
				item["coverHeight"] = rec.CoverHeight
			}
		}
		items = append(items, item)
	}

	c.JSON(http.StatusOK, map[string]any{
		"ok":            true,
		"items":         items,
		"taxonomies":    taxonomies,
		"archives":      archives,
		"total":         total,
		"page":          page,
		"more":          more,
		"privateAccess": privateAccess,
		"viewerId":      viewerID,
	})
}

func handlePublicArticleDetail(c *appkit.Context) {
	id, ok := parsePositiveID(c.Param("id"))
	if !ok {
		articleAPIError(c, sql.ErrNoRows)
		return
	}
	pubDB := appkit.OpenDB("public")
	rec, err := readablePublicArticle(pubDB, c.User(), id)
	if err != nil {
		articleAPIError(c, sql.ErrNoRows)
		return
	}

	taxByID, err := loadAllPublicTaxonomies(pubDB)
	if err != nil {
		articleAPIError(c, err)
		return
	}
	selectedIDs := map[int64]bool{}
	if rec.Published.CategoryID > 0 {
		selectedIDs[rec.Published.CategoryID] = true
	}
	for _, tid := range rec.Published.TagIDs {
		selectedIDs[tid] = true
	}
	selectedTax := make([]publicTaxonomyItem, 0, len(selectedIDs))
	for tid := range selectedIDs {
		if t, exists := taxByID[tid]; exists {
			selectedTax = append(selectedTax, publicTaxonomyItem{
				ID:       t.ID,
				Kind:     t.Kind,
				Name:     t.Name,
				ParentID: t.ParentID,
				Revision: t.Revision,
				Count:    0,
			})
		}
	}
	sort.Slice(selectedTax, func(i, j int) bool {
		if selectedTax[i].Kind != selectedTax[j].Kind {
			return selectedTax[i].Kind < selectedTax[j].Kind
		}
		return selectedTax[i].ID < selectedTax[j].ID
	})

	fileRows, err := pubDB.Query(`SELECT file_id, name, media_type, size_bytes, width, height FROM public_article_files WHERE article_id = ?`, rec.ID)
	if err != nil {
		articleAPIError(c, err)
		return
	}
	type pubFileRow struct {
		fileID    int64
		name      string
		mediaType string
		size      int64
		width     int
		height    int
	}
	fileMap := map[int64]pubFileRow{}
	for fileRows.Next() {
		var f pubFileRow
		if err := fileRows.Scan(&f.fileID, &f.name, &f.mediaType, &f.size, &f.width, &f.height); err != nil {
			fileRows.Close()
			articleAPIError(c, err)
			return
		}
		fileMap[f.fileID] = f
	}
	fileRows.Close()

	files := make([]publicArticleFileItem, 0, len(rec.Published.FileIDs))
	seenFiles := map[int64]bool{}
	for _, fid := range rec.Published.FileIDs {
		if seenFiles[fid] {
			continue
		}
		seenFiles[fid] = true
		if f, exists := fileMap[fid]; exists {
			files = append(files, publicArticleFileItem{
				ID:        "article-file:" + strconv.FormatInt(fid, 10),
				Name:      f.name,
				Size:      f.size,
				MediaType: f.mediaType,
			})
		}
	}

	res := map[string]any{
		"ok": true,
		"id": rec.ID,
		"article": map[string]any{
			"title":       rec.Published.Title,
			"summary":     rec.Published.Summary,
			"content":     rec.Published.Content,
			"visibility":  rec.Visibility,
			"categoryId":  rec.Published.CategoryID,
			"tagIds":      rec.Published.TagIDs,
			"coverFileId": rec.Published.CoverFileID,
		},
		"author":      rec.AuthorName,
		"publishedAt": rec.PublishedAt,
		"taxonomies":  selectedTax,
		"files":       files,
	}
	coverW, coverH := rec.Published.CoverWidth, rec.Published.CoverHeight
	if (coverW <= 0 || coverH <= 0) && rec.Published.CoverFileID > 0 {
		if f, exists := fileMap[rec.Published.CoverFileID]; exists && f.width > 0 && f.height > 0 {
			coverW, coverH = f.width, f.height
		} else if rec.CoverFileID == rec.Published.CoverFileID && rec.CoverWidth > 0 && rec.CoverHeight > 0 {
			coverW, coverH = rec.CoverWidth, rec.CoverHeight
		}
	}
	if coverW > 0 && coverH > 0 {
		res["coverWidth"] = coverW
		res["coverHeight"] = coverH
	}
	c.JSON(http.StatusOK, res)
}

func handlePublicArticleFile(c *appkit.Context) {
	articleID, ok := parsePositiveID(c.Param("id"))
	if !ok {
		articleAPIError(c, sql.ErrNoRows)
		return
	}
	fid, ok := parsePositiveID(c.Param("fileId"))
	if !ok {
		articleAPIError(c, sql.ErrNoRows)
		return
	}
	pubDB := appkit.OpenDB("public")
	if _, err := readablePublicArticle(pubDB, c.User(), articleID); err != nil {
		articleAPIError(c, sql.ErrNoRows)
		return
	}
	var mediaType string
	if err := pubDB.QueryRow(`SELECT media_type FROM public_article_files WHERE article_id = ? AND file_id = ?`, articleID, fid).Scan(&mediaType); err != nil {
		articleAPIError(c, sql.ErrNoRows)
		return
	}
	sendArticleFileResponse(c, fid, mediaType)
}

func handlePublicSite(c *appkit.Context) {
	pubDB := appkit.OpenDB("public")
	site, err := loadPublicArticleSite(pubDB)
	if err != nil {
		articleAPIError(c, err)
		return
	}
	c.JSON(http.StatusOK, map[string]any{"ok": true, "site": site})
}

func handlePublicQuote(c *appkit.Context) {
	if c.Method() == http.MethodHead {
		c.SetHeader("cache-control", "no-store")
		c.Bytes(http.StatusOK, "application/json; charset=utf-8", nil)
		return
	}
	pubDB := appkit.OpenDB("public")
	site, err := loadPublicArticleSite(pubDB)
	if err != nil {
		articleQuoteAPIError(c, err)
		return
	}
	rows, err := pubDB.Query(`SELECT quote_day, quote_text FROM public_site_quotes ORDER BY quote_day DESC LIMIT 30`)
	if err != nil {
		articleQuoteAPIError(c, err)
		return
	}
	defer rows.Close()
	items := []map[string]string{}
	today := articleQuoteDay(time.Now())
	todayText := ""
	for rows.Next() {
		var day, text string
		if err := rows.Scan(&day, &text); err != nil {
			articleQuoteAPIError(c, err)
			return
		}
		if strings.TrimSpace(text) == "" {
			continue
		}
		if day == today {
			todayText = text
		}
		items = append(items, map[string]string{"day": day, "text": text})
	}
	if err := rows.Err(); err != nil {
		articleQuoteAPIError(c, err)
		return
	}

	text := ""
	switch site.Config.Quote.Mode {
	case "none":
		text = ""
	case "api":
		if todayText != "" {
			text = todayText
		} else {
			text = site.Config.Description
		}
	default:
		text = site.Config.Description
	}
	c.JSON(http.StatusOK, map[string]any{"ok": true, "text": text, "items": items})
}

func handlePublicSiteFile(c *appkit.Context) {
	fid, ok := parsePositiveID(c.Param("fileId"))
	if !ok {
		articleAPIError(c, sql.ErrNoRows)
		return
	}
	pubDB := appkit.OpenDB("public")
	var mediaType string
	if err := pubDB.QueryRow(`SELECT media_type FROM public_site_files WHERE file_id = ?`, fid).Scan(&mediaType); err != nil {
		articleAPIError(c, sql.ErrNoRows)
		return
	}
	if !isValidSiteImageType(mediaType) {
		articleAPIError(c, sql.ErrNoRows)
		return
	}
	c.SendUserFile(http.StatusOK, formatFileID(fid), true)
}

func handlePublicSSR(c *appkit.Context) {
	pubDB := appkit.OpenDB("public")
	site, err := loadPublicArticleSite(pubDB)
	if err != nil {
		c.Text(http.StatusInternalServerError, "site unavailable")
		return
	}
	sub := strings.Trim(c.Param("*"), "/")
	pageTitle := site.Config.Name
	if strings.TrimSpace(pageTitle) == "" {
		pageTitle = "文章"
	}
	pageDesc := site.Config.Description
	var noscriptBody strings.Builder

	if sub != "" {
		id, ok := parsePositiveID(sub)
		if !ok {
			c.Bytes(http.StatusNotFound, "text/html; charset=utf-8", []byte("<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><title>404</title></head><body><h1>404</h1><p>文章不存在或无权访问。</p></body></html>"))
			return
		}
		rec, err := readablePublicArticle(pubDB, c.User(), id)
		if err != nil {
			c.Bytes(http.StatusNotFound, "text/html; charset=utf-8", []byte("<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><title>404</title></head><body><h1>404</h1><p>文章不存在或无权访问。</p></body></html>"))
			return
		}
		pageTitle = fmt.Sprintf("%s · %s", rec.Published.Title, pageTitle)
		if strings.TrimSpace(rec.Published.Summary) != "" {
			pageDesc = rec.Published.Summary
		}
		noscriptBody.WriteString("<article><h1>")
		noscriptBody.WriteString(html.EscapeString(rec.Published.Title))
		noscriptBody.WriteString("</h1>")
		if rec.Published.Summary != "" {
			noscriptBody.WriteString("<p>")
			noscriptBody.WriteString(html.EscapeString(rec.Published.Summary))
			noscriptBody.WriteString("</p>")
		}
		noscriptBody.WriteString("<pre>")
		noscriptBody.WriteString(html.EscapeString(rec.Published.Content))
		noscriptBody.WriteString("</pre></article>")
	} else {
		visible, _ := loadVisiblePublicArticles(pubDB, c.User())
		noscriptBody.WriteString("<h1>")
		noscriptBody.WriteString(html.EscapeString(pageTitle))
		noscriptBody.WriteString("</h1><ul>")
		limit := len(visible)
		if limit > 20 {
			limit = 20
		}
		for _, rec := range visible[:limit] {
			if rec.Visibility != "public" {
				continue
			}
			noscriptBody.WriteString(fmt.Sprintf(`<li><a href="%d">%s</a></li>`, rec.ID, html.EscapeString(rec.Published.Title)))
		}
		noscriptBody.WriteString("</ul>")
	}

	var doc bytes.Buffer
	doc.WriteString("<!doctype html>\n<html lang=\"zh-CN\">\n<head>\n")
	doc.WriteString("  <meta charset=\"utf-8\" />\n")
	doc.WriteString("  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n")
	doc.WriteString("  <meta name=\"xyzos-desk-ui\" content=\"1\" />\n")
	doc.WriteString("  <title>" + html.EscapeString(pageTitle) + "</title>\n")
	if strings.TrimSpace(pageDesc) != "" {
		doc.WriteString("  <meta name=\"description\" content=\"" + html.EscapeString(pageDesc) + "\" />\n")
	}
	doc.WriteString("  <link rel=\"alternate\" type=\"application/rss+xml\" title=\"" + html.EscapeString(site.Config.Name) + "\" href=\"rss.xml\" />\n")
	for _, css := range []string{
		"theme/blog-base.css",
		"theme/blog-components.css",
		"theme/blog-effects.css",
		"theme/blog-article.css",
		"theme/markdown.css",
		"theme/reader.css",
	} {
		doc.WriteString("  <link rel=\"stylesheet\" href=\"" + css + "\" />\n")
	}
	doc.WriteString("</head>\n<body>\n")
	doc.WriteString("  <div id=\"root\"></div>\n")
	doc.WriteString("  <noscript><main>" + noscriptBody.String() + "</main></noscript>\n")
	doc.WriteString("  <script type=\"module\" src=\"js/public.js\"></script>\n")
	doc.WriteString("</body>\n</html>\n")

	if c.Method() == http.MethodHead {
		c.Bytes(http.StatusOK, "text/html; charset=utf-8", nil)
		return
	}
	c.Bytes(http.StatusOK, "text/html; charset=utf-8", doc.Bytes())
}

type rssDocument struct {
	XMLName xml.Name   `xml:"rss"`
	Version string     `xml:"version,attr"`
	Channel rssChannel `xml:"channel"`
}

type rssChannel struct {
	Title       string    `xml:"title"`
	Description string    `xml:"description"`
	Link        string    `xml:"link"`
	Items       []rssItem `xml:"item"`
}

type rssItem struct {
	Title       string `xml:"title"`
	Link        string `xml:"link"`
	GUID        string `xml:"guid"`
	Description string `xml:"description"`
	PubDate     string `xml:"pubDate"`
}

func handlePublicRSS(c *appkit.Context) {
	pubDB := appkit.OpenDB("public")
	site, err := loadPublicArticleSite(pubDB)
	if err != nil {
		articleAPIError(c, err)
		return
	}
	// RSS 严格只包含 public 文章（不暴露任何私有文章）
	publicOnly, err := loadVisiblePublicArticles(pubDB, nil)
	if err != nil {
		articleAPIError(c, err)
		return
	}
	limit := len(publicOnly)
	if limit > 50 {
		limit = 50
	}
	items := make([]rssItem, 0, limit)
	for _, rec := range publicOnly[:limit] {
		link := "/articles/" + strconv.FormatInt(rec.ID, 10)
		desc := rec.Published.Summary
		if desc == "" {
			desc = rec.Published.Title
		}
		items = append(items, rssItem{
			Title:       rec.Published.Title,
			Link:        link,
			GUID:        link,
			Description: desc,
			PubDate:     time.UnixMilli(rec.PublishedAt).UTC().Format(time.RFC1123Z),
		})
	}
	feed := rssDocument{
		Version: "2.0",
		Channel: rssChannel{
			Title:       site.Config.Name,
			Description: site.Config.Description,
			Link:        "/articles",
			Items:       items,
		},
	}
	var buf bytes.Buffer
	buf.WriteString(xml.Header)
	out, err := xml.MarshalIndent(feed, "", "  ")
	if err != nil {
		articleAPIError(c, err)
		return
	}
	buf.Write(out)
	if c.Method() == http.MethodHead {
		c.Bytes(http.StatusOK, "application/rss+xml; charset=utf-8", nil)
		return
	}
	c.Bytes(http.StatusOK, "application/rss+xml; charset=utf-8", buf.Bytes())
}

type sitemapURLSet struct {
	XMLName xml.Name     `xml:"urlset"`
	Xmlns   string       `xml:"xmlns,attr"`
	URLs    []sitemapURL `xml:"url"`
}

type sitemapURL struct {
	Loc     string `xml:"loc"`
	LastMod string `xml:"lastmod,omitempty"`
}

func handlePublicSitemap(c *appkit.Context) {
	pubDB := appkit.OpenDB("public")
	// Sitemap 严格只包含 public 文章
	publicOnly, err := loadVisiblePublicArticles(pubDB, nil)
	if err != nil {
		articleAPIError(c, err)
		return
	}
	urls := make([]sitemapURL, 0, len(publicOnly)+1)
	urls = append(urls, sitemapURL{Loc: "/articles"})
	for _, rec := range publicOnly {
		urls = append(urls, sitemapURL{
			Loc:     "/articles/" + strconv.FormatInt(rec.ID, 10),
			LastMod: time.UnixMilli(rec.PublishedAt).UTC().Format("2006-01-02"),
		})
	}
	doc := sitemapURLSet{
		Xmlns: "http://www.sitemaps.org/schemas/sitemap/0.9",
		URLs:  urls,
	}
	var buf bytes.Buffer
	buf.WriteString(xml.Header)
	out, err := xml.MarshalIndent(doc, "", "  ")
	if err != nil {
		articleAPIError(c, err)
		return
	}
	buf.Write(out)
	if c.Method() == http.MethodHead {
		c.Bytes(http.StatusOK, "application/xml; charset=utf-8", nil)
		return
	}
	c.Bytes(http.StatusOK, "application/xml; charset=utf-8", buf.Bytes())
}

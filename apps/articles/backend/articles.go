package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/xyzphp/desk-store/sdk/appkit"
)

var articleMediaPattern = regexp.MustCompile(`!?\[[^\]\r\n]+\]\(article-file:([1-9][0-9]{0,18})(?:[ \t]+"[^"\r\n]*")?(?:[ \t]+=[0-9]{2,4})?(?:[ \t]+row=[1-4])?\)`)

type articleDraft struct {
	Title       string  `json:"title"`
	Summary     string  `json:"summary"`
	Content     string  `json:"content"`
	CategoryID  int64   `json:"categoryId"`
	CoverFileID int64   `json:"coverFileId"`
	CoverWidth  int     `json:"coverWidth,omitempty"`
	CoverHeight int     `json:"coverHeight,omitempty"`
	TagIDs      []int64 `json:"tagIds"`
	FileIDs     []int64 `json:"fileIds"`
	Visibility  string  `json:"visibility"`
}

type articleRecord struct {
	ID          int64         `json:"id"`
	UserID      int64         `json:"-"`
	AuthorName  string        `json:"-"`
	Draft       articleDraft  `json:"draft"`
	Published   *articleDraft `json:"published"`
	Visibility  string        `json:"visibility"`
	Revision    int64         `json:"revision"`
	PublishedAt int64         `json:"publishedAt"`
	TrashedAt   int64         `json:"trashedAt"`
	CreatedAt   int64         `json:"createdAt"`
	UpdatedAt   int64         `json:"updatedAt"`
}

type articleTaxonomy struct {
	ID       int64  `json:"id"`
	Kind     string `json:"kind"`
	Name     string `json:"name"`
	ParentID int64  `json:"parentId"`
	Revision int64  `json:"revision"`
}

type articleSaveRequest struct {
	Revision int64        `json:"revision"`
	Action   string       `json:"action"`
	Draft    articleDraft `json:"draft"`
}

type articleActionRequest struct {
	Revision int64  `json:"revision"`
	Action   string `json:"action"`
}

type taxonomyMutateRequest struct {
	ID       int64  `json:"id"`
	Revision int64  `json:"revision"`
	Kind     string `json:"kind"`
	Name     string `json:"name"`
	ParentID int64  `json:"parentId"`
	Action   string `json:"action"`
}

const articleColumns = `id, user_id, author_name, draft_json, published_json, visibility, revision, published_at, trashed_at, created_at, updated_at`

type rowScanner interface {
	Scan(dest ...any) error
}

func scanArticle(row rowScanner) (articleRecord, error) {
	var a articleRecord
	var draftRaw, publishedRaw string
	if err := row.Scan(
		&a.ID, &a.UserID, &a.AuthorName, &draftRaw, &publishedRaw,
		&a.Visibility, &a.Revision, &a.PublishedAt, &a.TrashedAt, &a.CreatedAt, &a.UpdatedAt,
	); err != nil {
		return a, err
	}
	if err := json.Unmarshal([]byte(draftRaw), &a.Draft); err != nil {
		return a, err
	}
	if a.Draft.TagIDs == nil {
		a.Draft.TagIDs = []int64{}
	}
	if a.Draft.FileIDs == nil {
		a.Draft.FileIDs = []int64{}
	}
	if a.PublishedAt != 0 {
		a.Published = &articleDraft{}
		if err := json.Unmarshal([]byte(publishedRaw), a.Published); err != nil {
			return a, err
		}
		if a.Published.TagIDs == nil {
			a.Published.TagIDs = []int64{}
		}
		if a.Published.FileIDs == nil {
			a.Published.FileIDs = []int64{}
		}
	}
	return a, nil
}

func articleSummary(record articleRecord) map[string]any {
	draft, _ := json.Marshal(record.Draft)
	published, _ := json.Marshal(record.Published)
	return map[string]any{
		"id":              record.ID,
		"title":           record.Draft.Title,
		"summary":         record.Draft.Summary,
		"categoryId":      record.Draft.CategoryID,
		"tagIds":          record.Draft.TagIDs,
		"coverFileId":     record.Draft.CoverFileID,
		"coverWidth":      record.Draft.CoverWidth,
		"coverHeight":     record.Draft.CoverHeight,
		"visibility":      record.Visibility,
		"draftVisibility": record.Draft.Visibility,
		"revision":        record.Revision,
		"publishedAt":     record.PublishedAt,
		"trashedAt":       record.TrashedAt,
		"updatedAt":       record.UpdatedAt,
		"changed":         record.Published != nil && string(draft) != string(published),
	}
}

func listOwnerTaxonomies(db *sql.DB, owner int64) ([]articleTaxonomy, error) {
	rows, err := db.Query(`SELECT id, kind, name, parent_id, revision FROM user_article_taxonomies WHERE user_id = ? ORDER BY kind, id`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []articleTaxonomy{}
	for rows.Next() {
		var item articleTaxonomy
		if err := rows.Scan(&item.ID, &item.Kind, &item.Name, &item.ParentID, &item.Revision); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func listOwnerArticles(db *sql.DB, owner int64) ([]articleRecord, error) {
	rows, err := db.Query(`SELECT `+articleColumns+` FROM user_articles WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 500`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []articleRecord{}
	for rows.Next() {
		rec, err := scanArticle(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, rec)
	}
	return items, rows.Err()
}

func buildArticleCatalog(owner int64) (map[string]any, error) {
	db := appkit.OpenDB("shared")
	articles, err := listOwnerArticles(db, owner)
	if err != nil {
		return nil, err
	}
	metas, _ := listOwnerFileMetaMap(db, owner)
	items := make([]map[string]any, 0, len(articles))
	for _, rec := range articles {
		summary := articleSummary(rec)
		if rec.Draft.CoverFileID > 0 && (rec.Draft.CoverWidth <= 0 || rec.Draft.CoverHeight <= 0) {
			if meta, ok := metas[rec.Draft.CoverFileID]; ok && meta.Width > 0 && meta.Height > 0 {
				summary["coverWidth"] = meta.Width
				summary["coverHeight"] = meta.Height
			}
		}
		items = append(items, summary)
	}
	taxonomies, err := listOwnerTaxonomies(db, owner)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"ok":         true,
		"items":      items,
		"taxonomies": taxonomies,
		"publicBase": "/articles",
	}, nil
}

func handleListArticles(c *appkit.Context) {
	user, ok := requireUser(c)
	if !ok {
		return
	}
	catalog, err := buildArticleCatalog(user.ID)
	if err != nil {
		articleAPIError(c, err)
		return
	}
	c.JSON(http.StatusOK, catalog)
}

func getArticleDetail(owner, id int64) (map[string]any, error) {
	db := appkit.OpenDB("shared")
	record, err := scanArticle(db.QueryRow(`SELECT `+articleColumns+` FROM user_articles WHERE id = ? AND user_id = ?`, id, owner))
	if err != nil {
		return nil, err
	}
	fileIDs := append([]int64{}, record.Draft.FileIDs...)
	if record.Draft.CoverFileID > 0 {
		found := false
		for _, fid := range fileIDs {
			if fid == record.Draft.CoverFileID {
				found = true
				break
			}
		}
		if !found {
			fileIDs = append(fileIDs, record.Draft.CoverFileID)
		}
	}
	files, err := loadArticleFileViews(db, owner, fileIDs)
	if err != nil {
		return nil, err
	}
	return map[string]any{"ok": true, "article": record, "files": files}, nil
}

func handleGetArticle(c *appkit.Context) {
	user, ok := requireUser(c)
	if !ok {
		return
	}
	id, ok := parsePositiveID(c.Param("id"))
	if !ok {
		articleAPIError(c, sql.ErrNoRows)
		return
	}
	detail, err := getArticleDetail(user.ID, id)
	if err != nil {
		articleAPIError(c, err)
		return
	}
	c.JSON(http.StatusOK, detail)
}

func handleCreateArticle(c *appkit.Context) {
	user, ok := requireUser(c)
	if !ok {
		return
	}
	var req articleSaveRequest
	if !decodeStrictJSON(c, &req, articleBodyMaxBytes) {
		return
	}
	if req.Action == "" {
		req.Action = "save"
	}
	if c.Entry() == "token" && req.Action == "publish" {
		c.Error(http.StatusForbidden, "通过个人令牌发布文章需要 publish 权限点，请先保存草稿再调用 POST /publish/{id}")
		return
	}
	saveArticleHandler(c, user, 0, req)
}

func handleUpdateArticle(c *appkit.Context) {
	user, ok := requireUser(c)
	if !ok {
		return
	}
	id, ok := parsePositiveID(c.Param("id"))
	if !ok {
		articleAPIError(c, sql.ErrNoRows)
		return
	}
	var req articleSaveRequest
	if !decodeStrictJSON(c, &req, articleBodyMaxBytes) {
		return
	}
	if req.Action == "" {
		req.Action = "save"
	}
	if c.Entry() == "token" && req.Action == "publish" {
		c.Error(http.StatusForbidden, "通过个人令牌发布文章需要 publish 权限点，请调用 POST /publish/{id}")
		return
	}
	saveArticleHandler(c, user, id, req)
}

func handleTokenPublishArticle(c *appkit.Context) {
	user, ok := requireUser(c)
	if !ok {
		return
	}
	id, ok := parsePositiveID(c.Param("id"))
	if !ok {
		articleAPIError(c, sql.ErrNoRows)
		return
	}
	var req articleSaveRequest
	if !decodeStrictJSON(c, &req, articleBodyMaxBytes) {
		return
	}
	req.Action = "publish"
	saveArticleHandler(c, user, id, req)
}

func handleTokenUnpublishArticle(c *appkit.Context) {
	user, ok := requireUser(c)
	if !ok {
		return
	}
	id, ok := parsePositiveID(c.Param("id"))
	if !ok {
		articleAPIError(c, sql.ErrNoRows)
		return
	}
	var req struct {
		Revision int64 `json:"revision"`
	}
	if !decodeStrictJSON(c, &req, 4<<10) {
		return
	}
	runArticleAction(c, user, id, articleActionRequest{Revision: req.Revision, Action: "unpublish"})
}

func handleTokenRestoreArticle(c *appkit.Context) {
	user, ok := requireUser(c)
	if !ok {
		return
	}
	id, ok := parsePositiveID(c.Param("id"))
	if !ok {
		articleAPIError(c, sql.ErrNoRows)
		return
	}
	var req struct {
		Revision int64 `json:"revision"`
	}
	if !decodeStrictJSON(c, &req, 4<<10) {
		return
	}
	runArticleAction(c, user, id, articleActionRequest{Revision: req.Revision, Action: "restore"})
}

func validateArticleDraft(db *sql.DB, owner int64, d *articleDraft, publishing bool) error {
	d.Title = strings.TrimSpace(d.Title)
	d.Summary = strings.TrimSpace(d.Summary)
	if d.Visibility == "" {
		d.Visibility = "private"
	}
	if !validArticleText(d.Title, articleTitleLimit, false) ||
		!validArticleText(d.Summary, articleSummaryLimit, true) ||
		!validArticleText(d.Content, articleContentLimit, true) ||
		len(d.Content) > 320000 ||
		(publishing && (d.Title == "" || strings.TrimSpace(d.Content) == "")) ||
		(d.Visibility != "private" && d.Visibility != "public") ||
		d.CategoryID < 0 ||
		len(d.TagIDs) > 12 ||
		len(d.FileIDs) > 32 {
		return errArticleInvalid
	}

	taxonomies, err := listOwnerTaxonomies(db, owner)
	if err != nil {
		return err
	}
	taxByID := make(map[int64]articleTaxonomy, len(taxonomies))
	for _, t := range taxonomies {
		taxByID[t.ID] = t
	}

	seenTags := map[int64]bool{}
	for _, id := range d.TagIDs {
		if id <= 0 || seenTags[id] {
			return errArticleInvalid
		}
		t, exists := taxByID[id]
		if !exists || t.Kind != "tag" {
			return errArticleInvalid
		}
		seenTags[id] = true
	}
	if d.CategoryID != 0 {
		t, exists := taxByID[d.CategoryID]
		if !exists || t.Kind != "category" {
			return errArticleInvalid
		}
	}

	seenFiles := map[int64]bool{}
	for _, id := range d.FileIDs {
		if id <= 0 || seenFiles[id] {
			return errArticleInvalid
		}
		seenFiles[id] = true
	}
	if d.CoverFileID < 0 || d.CoverWidth < 0 || d.CoverHeight < 0 || d.CoverWidth > 10000 || d.CoverHeight > 10000 {
		return errArticleInvalid
	}
	for _, match := range articleMediaPattern.FindAllStringSubmatch(d.Content, -1) {
		fid, err := strconv.ParseInt(match[1], 10, 64)
		if err != nil {
			return errArticleInvalid
		}
		if !seenFiles[fid] {
			d.FileIDs = append(d.FileIDs, fid)
			seenFiles[fid] = true
		}
	}
	if len(d.FileIDs) > 32 {
		return errArticleInvalid
	}

	allFiles := append([]int64{}, d.FileIDs...)
	if d.CoverFileID > 0 && !seenFiles[d.CoverFileID] {
		allFiles = append(allFiles, d.CoverFileID)
	}
	for _, fid := range allFiles {
		if _, err := ensureOwnedFileMeta(db, owner, fid); err != nil {
			return errArticleInvalid
		}
	}

	if d.TagIDs == nil {
		d.TagIDs = []int64{}
	}
	if d.FileIDs == nil {
		d.FileIDs = []int64{}
	}
	return nil
}

func saveArticleCore(user *appkit.User, id int64, req articleSaveRequest) (articleRecord, int, error) {
	if req.Action == "" {
		req.Action = "save"
	}
	if req.Action != "save" && req.Action != "publish" {
		return articleRecord{}, http.StatusBadRequest, errArticleInvalid
	}
	db := appkit.OpenDB("shared")
	now := time.Now().UnixMilli()
	record := articleRecord{
		ID:         id,
		UserID:     user.ID,
		AuthorName: strings.TrimSpace(user.DisplayName),
		Visibility: "private",
		Revision:   1,
		CreatedAt:  now,
	}
	if id != 0 {
		existing, err := scanArticle(db.QueryRow(`SELECT `+articleColumns+` FROM user_articles WHERE id = ? AND user_id = ? AND trashed_at = 0`, id, user.ID))
		if err != nil {
			return articleRecord{}, 0, err
		}
		if req.Revision != existing.Revision {
			return articleRecord{}, http.StatusConflict, errArticleConflict
		}
		record = existing
		if strings.TrimSpace(user.DisplayName) != "" {
			record.AuthorName = strings.TrimSpace(user.DisplayName)
		}
	} else {
		var count int
		if err := db.QueryRow(`SELECT COUNT(*) FROM user_articles WHERE user_id = ?`, user.ID).Scan(&count); err != nil {
			return articleRecord{}, 0, err
		}
		if count >= maxUserArticles {
			return articleRecord{}, http.StatusBadRequest, errors.New("每个账号最多保存 500 篇文章，请清理文章回收站")
		}
	}

	if err := validateArticleDraft(db, user.ID, &req.Draft, req.Action == "publish"); err != nil {
		return articleRecord{}, 0, err
	}

	record.Draft = req.Draft
	record.UpdatedAt = now
	if req.Action == "publish" {
		published := req.Draft
		record.Published = &published
		record.Visibility = published.Visibility
		record.PublishedAt = now
	}

	draftBytes, _ := json.Marshal(record.Draft)
	publishedBytes := []byte("{}")
	if record.Published != nil {
		publishedBytes, _ = json.Marshal(record.Published)
	}

	prevFiles, _ := listArticleFileIDs(db, id)

	if id == 0 {
		res, err := db.Exec(
			`INSERT INTO user_articles(user_id, author_name, draft_json, published_json, visibility, revision, published_at, trashed_at, created_at, updated_at) VALUES(?, ?, ?, ?, ?, 1, ?, 0, ?, ?)`,
			user.ID, record.AuthorName, string(draftBytes), string(publishedBytes), record.Visibility, record.PublishedAt, record.CreatedAt, record.UpdatedAt,
		)
		if err != nil {
			return articleRecord{}, 0, err
		}
		newID, err := res.LastInsertId()
		if err != nil {
			return articleRecord{}, 0, err
		}
		record.ID = newID
	} else {
		res, err := db.Exec(
			`UPDATE user_articles SET author_name = ?, draft_json = ?, published_json = ?, visibility = ?, published_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND user_id = ? AND revision = ? AND trashed_at = 0`,
			record.AuthorName, string(draftBytes), string(publishedBytes), record.Visibility, record.PublishedAt, record.UpdatedAt, id, user.ID, req.Revision,
		)
		if err != nil {
			return articleRecord{}, 0, err
		}
		n, err := res.RowsAffected()
		if err != nil {
			return articleRecord{}, 0, err
		}
		if n != 1 {
			return articleRecord{}, http.StatusConflict, errArticleConflict
		}
		record.Revision++
	}

	if err := syncArticleReferences(db, record, prevFiles); err != nil {
		return articleRecord{}, 0, err
	}
	if record.Published != nil && record.TrashedAt == 0 {
		if err := syncPublicArticleProjection(db, record); err != nil {
			return articleRecord{}, 0, err
		}
	}
	status := http.StatusOK
	if id == 0 {
		status = http.StatusCreated
	}
	return record, status, nil
}

func saveArticleHandler(c *appkit.Context, user *appkit.User, id int64, req articleSaveRequest) {
	record, status, err := saveArticleCore(user, id, req)
	if err != nil {
		if status == http.StatusBadRequest && !errors.Is(err, errArticleInvalid) {
			c.Error(http.StatusBadRequest, err.Error())
			return
		}
		articleAPIError(c, err)
		return
	}
	c.JSON(status, map[string]any{"ok": true, "article": record})
}

func handleArticleAction(c *appkit.Context) {
	user, ok := requireUser(c)
	if !ok {
		return
	}
	id, ok := parsePositiveID(c.Param("id"))
	if !ok {
		articleAPIError(c, sql.ErrNoRows)
		return
	}
	var req articleActionRequest
	if !decodeStrictJSON(c, &req, 4<<10) {
		return
	}
	if c.Entry() == "token" && req.Action != "trash" && req.Action != "delete" {
		c.Error(http.StatusForbidden, "此令牌路由仅允许 trash/delete；请分别调用 POST /publish/{id}/unpublish 或 POST /restore/{id}")
		return
	}
	runArticleAction(c, user, id, req)
}

func executeArticleAction(user *appkit.User, id int64, req articleActionRequest) (articleRecord, bool, error) {
	db := appkit.OpenDB("shared")
	record, err := scanArticle(db.QueryRow(`SELECT `+articleColumns+` FROM user_articles WHERE id = ? AND user_id = ?`, id, user.ID))
	if err != nil {
		return articleRecord{}, false, err
	}
	if req.Revision != record.Revision {
		return articleRecord{}, false, errArticleConflict
	}
	now := time.Now().UnixMilli()
	switch req.Action {
	case "trash", "unpublish":
		if record.TrashedAt != 0 {
			return articleRecord{}, false, errArticleInvalid
		}
		if req.Action == "trash" {
			record.TrashedAt = now
		}
	case "restore", "delete":
		if record.TrashedAt == 0 {
			return articleRecord{}, false, errArticleInvalid
		}
		if req.Action == "restore" {
			record.TrashedAt = 0
		}
	default:
		return articleRecord{}, false, errArticleInvalid
	}

	prevFiles, _ := listArticleFileIDs(db, id)

	if req.Action == "delete" {
		res, err := db.Exec(`DELETE FROM user_articles WHERE id = ? AND user_id = ? AND revision = ?`, id, user.ID, req.Revision)
		if err != nil {
			return articleRecord{}, false, err
		}
		n, err := res.RowsAffected()
		if err != nil {
			return articleRecord{}, false, err
		}
		if n != 1 {
			return articleRecord{}, false, errArticleConflict
		}
		_, _ = db.Exec(`DELETE FROM user_article_files WHERE article_id = ?`, id)
		_, _ = db.Exec(`DELETE FROM user_article_public_taxonomies WHERE article_id = ?`, id)
		releaseArticleFileReferences(id, prevFiles)
		_ = removePublicArticleProjection(id)
		return record, true, nil
	}

	res, err := db.Exec(
		`UPDATE user_articles SET published_json = '{}', visibility = 'private', published_at = 0, trashed_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND user_id = ? AND revision = ?`,
		record.TrashedAt, now, id, user.ID, req.Revision,
	)
	if err != nil {
		return articleRecord{}, false, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return articleRecord{}, false, err
	}
	if n != 1 {
		return articleRecord{}, false, errArticleConflict
	}
	record.Published = nil
	record.Visibility = "private"
	record.PublishedAt = 0
	record.UpdatedAt = now
	record.Revision++

	if err := syncArticleReferences(db, record, prevFiles); err != nil {
		return articleRecord{}, false, err
	}
	if err := removePublicArticleProjection(id); err != nil {
		return articleRecord{}, false, err
	}
	return record, false, nil
}

func runArticleAction(c *appkit.Context, user *appkit.User, id int64, req articleActionRequest) {
	record, deleted, err := executeArticleAction(user, id, req)
	if err != nil {
		articleAPIError(c, err)
		return
	}
	if deleted {
		c.JSON(http.StatusOK, map[string]any{"ok": true})
		return
	}
	c.JSON(http.StatusOK, map[string]any{"ok": true, "article": record})
}

func taxonomyDepth(taxonomies []articleTaxonomy, categoryID int64) (int, bool) {
	if categoryID == 0 {
		return 0, true
	}
	depth := 0
	curr := categoryID
	visited := map[int64]bool{}
	for curr != 0 {
		if visited[curr] {
			return 0, false
		}
		visited[curr] = true
		depth++
		found := false
		for _, t := range taxonomies {
			if t.ID == curr && t.Kind == "category" {
				curr = t.ParentID
				found = true
				break
			}
		}
		if !found {
			return 0, false
		}
	}
	return depth, true
}

func maxDescendantDepth(taxonomies []articleTaxonomy, categoryID int64) int {
	maxDepth := 0
	for _, t := range taxonomies {
		if t.Kind == "category" && t.ParentID == categoryID {
			sub := 1 + maxDescendantDepth(taxonomies, t.ID)
			if sub > maxDepth {
				maxDepth = sub
			}
		}
	}
	return maxDepth
}

func mutateTaxonomyCore(owner int64, req taxonomyMutateRequest) (int64, int, error) {
	req.Name = strings.TrimSpace(req.Name)
	if (req.Action != "save" && req.Action != "delete") ||
		req.ID < 0 ||
		req.ParentID < 0 ||
		(req.Kind != "category" && req.Kind != "tag") ||
		(req.Kind == "tag" && req.ParentID != 0) ||
		(req.Action == "save" && (req.Name == "" || !validArticleText(req.Name, 40, false))) {
		return 0, http.StatusBadRequest, errArticleInvalid
	}

	db := appkit.OpenDB("shared")
	taxonomies, err := listOwnerTaxonomies(db, owner)
	if err != nil {
		return 0, http.StatusInternalServerError, err
	}

	if req.Action == "save" && req.ParentID != 0 {
		if req.Kind != "category" {
			return 0, http.StatusBadRequest, errors.New("只有分类可以设置上级")
		}
		if req.ID != 0 && req.ParentID == req.ID {
			return 0, http.StatusBadRequest, errors.New("上级分类不能是自身")
		}
		parentDepth, valid := taxonomyDepth(taxonomies, req.ParentID)
		if !valid || parentDepth < 1 {
			return 0, http.StatusBadRequest, errors.New("指定的一级或二级上级分类不存在")
		}
		if parentDepth >= 3 {
			return 0, http.StatusBadRequest, errors.New("分类层级最多支持三级")
		}
		if req.ID != 0 {
			curr := req.ParentID
			for curr != 0 {
				if curr == req.ID {
					return 0, http.StatusBadRequest, errors.New("不能将上级分类设置为当前分类的子分类")
				}
				pFound := false
				for _, t := range taxonomies {
					if t.ID == curr && t.Kind == "category" {
						curr = t.ParentID
						pFound = true
						break
					}
				}
				if !pFound {
					break
				}
			}
			descDepth := maxDescendantDepth(taxonomies, req.ID)
			if parentDepth+1+descDepth > 3 {
				return 0, http.StatusBadRequest, errors.New("调整后子分类层级将超过三级限制")
			}
		}
	}

	found := req.ID == 0
	for _, item := range taxonomies {
		if item.ID == req.ID {
			found = item.Kind == req.Kind
			if item.Revision != req.Revision {
				return 0, http.StatusConflict, errArticleConflict
			}
		}
		if item.ID != req.ID && item.Kind == req.Kind && item.ParentID == req.ParentID && strings.EqualFold(item.Name, req.Name) && req.Action == "save" {
			return 0, http.StatusConflict, errors.New("同层级已有同名分类或标签")
		}
	}
	if !found {
		return 0, http.StatusNotFound, sql.ErrNoRows
	}

	if req.Action == "delete" {
		if req.ID == 0 {
			return 0, http.StatusBadRequest, errArticleInvalid
		}
		for _, item := range taxonomies {
			if item.Kind == "category" && item.ParentID == req.ID {
				return 0, http.StatusConflict, errors.New("该分类下包含子分类，请先删除或移动子分类")
			}
		}
		articles, err := listOwnerArticles(db, owner)
		if err != nil {
			return 0, http.StatusInternalServerError, err
		}
		for _, rec := range articles {
			for _, d := range []*articleDraft{&rec.Draft, rec.Published} {
				if d == nil {
					continue
				}
				if d.CategoryID == req.ID {
					return 0, http.StatusConflict, errArticleInUse
				}
				for _, tid := range d.TagIDs {
					if tid == req.ID {
						return 0, http.StatusConflict, errArticleInUse
					}
				}
			}
		}
		if _, err := db.Exec(`DELETE FROM user_article_taxonomies WHERE id = ? AND user_id = ? AND revision = ?`, req.ID, owner, req.Revision); err != nil {
			return 0, http.StatusInternalServerError, err
		}
		pubDB := appkit.OpenDB("public")
		_, _ = pubDB.Exec(`DELETE FROM public_taxonomies WHERE id = ?`, req.ID)
		return req.ID, http.StatusOK, nil
	}

	now := time.Now().UnixMilli()
	if req.ID == 0 {
		if len(taxonomies) >= 200 {
			return 0, http.StatusBadRequest, errors.New("分类和标签合计最多 200 项")
		}
		res, err := db.Exec(
			`INSERT INTO user_article_taxonomies(user_id, kind, name, parent_id, revision, created_at, updated_at) VALUES(?, ?, ?, ?, 1, ?, ?)`,
			owner, req.Kind, req.Name, req.ParentID, now, now,
		)
		if err != nil {
			return 0, http.StatusInternalServerError, err
		}
		newID, err := res.LastInsertId()
		if err != nil {
			return 0, http.StatusInternalServerError, err
		}
		return newID, http.StatusOK, nil
	}

	res, err := db.Exec(
		`UPDATE user_article_taxonomies SET name = ?, parent_id = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND revision = ?`,
		req.Name, req.ParentID, now, req.ID, owner, req.Revision,
	)
	if err != nil {
		return 0, http.StatusInternalServerError, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, http.StatusInternalServerError, err
	}
	if n != 1 {
		return 0, http.StatusConflict, errArticleConflict
	}
	// 同步公开库中已存在的分类/标签（及其新上级链路）
	if updatedTax, err := listOwnerTaxonomies(db, owner); err == nil {
		syncPublicTaxonomyUpdate(owner, req.ID, updatedTax)
	}
	return req.ID, http.StatusOK, nil
}

func handleTaxonomy(c *appkit.Context) {
	user, ok := requireUser(c)
	if !ok {
		return
	}
	var req taxonomyMutateRequest
	if !decodeStrictJSON(c, &req, 16<<10) {
		return
	}
	if c.Entry() == "token" && req.Action == "delete" {
		c.Error(http.StatusForbidden, "通过个人令牌删除分类或标签需要 delete 权限点，请调用 DELETE /taxonomies/{id}")
		return
	}
	id, status, err := mutateTaxonomyCore(user.ID, req)
	if err != nil {
		if !errors.Is(err, errArticleInvalid) && !errors.Is(err, errArticleConflict) && !errors.Is(err, errArticleInUse) && !errors.Is(err, sql.ErrNoRows) {
			c.Error(status, err.Error())
			return
		}
		articleAPIError(c, err)
		return
	}
	c.JSON(http.StatusOK, map[string]any{"ok": true, "id": id})
}

func handleTokenDeleteTaxonomy(c *appkit.Context) {
	user, ok := requireUser(c)
	if !ok {
		return
	}
	id, ok := parsePositiveID(c.Param("id"))
	if !ok {
		articleAPIError(c, sql.ErrNoRows)
		return
	}
	revision, _ := strconv.ParseInt(c.Query().Get("revision"), 10, 64)
	kind := strings.TrimSpace(c.Query().Get("kind"))
	if kind == "" {
		db := appkit.OpenDB("shared")
		_ = db.QueryRow(`SELECT kind, revision FROM user_article_taxonomies WHERE id = ? AND user_id = ?`, id, user.ID).Scan(&kind, &revision)
		if kind == "" {
			articleAPIError(c, sql.ErrNoRows)
			return
		}
	}
	resID, status, err := mutateTaxonomyCore(user.ID, taxonomyMutateRequest{
		ID:       id,
		Revision: revision,
		Kind:     kind,
		Action:   "delete",
	})
	if err != nil {
		if !errors.Is(err, errArticleInvalid) && !errors.Is(err, errArticleConflict) && !errors.Is(err, errArticleInUse) && !errors.Is(err, sql.ErrNoRows) {
			c.Error(status, err.Error())
			return
		}
		articleAPIError(c, err)
		return
	}
	c.JSON(http.StatusOK, map[string]any{"ok": true, "id": resID})
}

// ---- 公开库投影同步 ----

func resolvePublishedCover(draft articleDraft, metas map[int64]articleFileMeta) (int64, int, int) {
	candidates := []int64{}
	if draft.CoverFileID > 0 {
		candidates = append(candidates, draft.CoverFileID)
	}
	for _, match := range articleMediaPattern.FindAllStringSubmatch(draft.Content, -1) {
		if strings.HasPrefix(match[0], "![") {
			if fid, err := strconv.ParseInt(match[1], 10, 64); err == nil && fid > 0 {
				candidates = append(candidates, fid)
			}
		}
	}
	for _, fid := range candidates {
		meta, ok := metas[fid]
		if ok && (meta.MediaType == "image/png" || meta.MediaType == "image/jpeg") {
			w, h := meta.Width, meta.Height
			if fid == draft.CoverFileID && draft.CoverWidth > 0 && draft.CoverHeight > 0 {
				w, h = draft.CoverWidth, draft.CoverHeight
			}
			return fid, w, h
		}
	}
	return 0, 0, 0
}

func syncPublicArticleProjection(sharedDB *sql.DB, record articleRecord) error {
	if record.Published == nil || record.PublishedAt == 0 || record.TrashedAt != 0 {
		return removePublicArticleProjection(record.ID)
	}
	pubDB := appkit.OpenDB("public")
	pubBytes, err := json.Marshal(record.Published)
	if err != nil {
		return err
	}

	metas, _ := listOwnerFileMetaMap(sharedDB, record.UserID)
	coverID, coverW, coverH := resolvePublishedCover(*record.Published, metas)

	_, err = pubDB.Exec(
		`INSERT INTO public_articles(id, user_id, author_name, published_json, visibility, published_at, cover_file_id, cover_width, cover_height)
		 VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
		   author_name = excluded.author_name,
		   published_json = excluded.published_json,
		   visibility = excluded.visibility,
		   published_at = excluded.published_at,
		   cover_file_id = excluded.cover_file_id,
		   cover_width = excluded.cover_width,
		   cover_height = excluded.cover_height`,
		record.ID, record.UserID, record.AuthorName, string(pubBytes), record.Visibility, record.PublishedAt, coverID, coverW, coverH,
	)
	if err != nil {
		return err
	}

	// 同步文章分类/标签映射与涉及的分类树节点
	_, _ = pubDB.Exec(`DELETE FROM public_article_taxonomies WHERE article_id = ?`, record.ID)
	ownerTax, err := listOwnerTaxonomies(sharedDB, record.UserID)
	if err == nil {
		taxByID := make(map[int64]articleTaxonomy, len(ownerTax))
		for _, t := range ownerTax {
			taxByID[t.ID] = t
		}
		taxIDs := append([]int64{}, record.Published.TagIDs...)
		if record.Published.CategoryID != 0 {
			taxIDs = append(taxIDs, record.Published.CategoryID)
		}
		toUpsert := map[int64]articleTaxonomy{}
		for _, tid := range taxIDs {
			if _, err := pubDB.Exec(`INSERT OR IGNORE INTO public_article_taxonomies(article_id, taxonomy_id) VALUES(?, ?)`, record.ID, tid); err != nil {
				return err
			}
			curr := tid
			visited := map[int64]bool{}
			for curr != 0 && !visited[curr] {
				visited[curr] = true
				if t, ok := taxByID[curr]; ok {
					toUpsert[t.ID] = t
					curr = t.ParentID
				} else {
					break
				}
			}
		}
		for _, t := range toUpsert {
			_, _ = pubDB.Exec(
				`INSERT INTO public_taxonomies(id, user_id, kind, name, parent_id, revision) VALUES(?, ?, ?, ?, ?, ?)
				 ON CONFLICT(id) DO UPDATE SET name = excluded.name, parent_id = excluded.parent_id, revision = excluded.revision`,
				t.ID, record.UserID, t.Kind, t.Name, t.ParentID, t.Revision,
			)
		}
	}

	// 同步发布快照引用的文件元信息
	_, _ = pubDB.Exec(`DELETE FROM public_article_files WHERE article_id = ?`, record.ID)
	pubFileSet := map[int64]bool{}
	for _, fid := range record.Published.FileIDs {
		pubFileSet[fid] = true
	}
	if record.Published.CoverFileID > 0 {
		pubFileSet[record.Published.CoverFileID] = true
	}
	fileIDs := make([]int64, 0, len(pubFileSet))
	for fid := range pubFileSet {
		fileIDs = append(fileIDs, fid)
	}
	sort.Slice(fileIDs, func(i, j int) bool { return fileIDs[i] < fileIDs[j] })
	for _, fid := range fileIDs {
		meta := metas[fid]
		name := meta.Name
		if name == "" {
			name = "file-" + strconv.FormatInt(fid, 10)
		}
		mediaType := meta.MediaType
		if mediaType == "" {
			mediaType = "application/octet-stream"
		}
		_, _ = pubDB.Exec(
			`INSERT INTO public_article_files(article_id, file_id, name, media_type, size_bytes, width, height) VALUES(?, ?, ?, ?, ?, ?, ?)`,
			record.ID, fid, name, mediaType, meta.SizeBytes, meta.Width, meta.Height,
		)
	}
	return nil
}

func removePublicArticleProjection(articleID int64) error {
	pubDB := appkit.OpenDB("public")
	_, _ = pubDB.Exec(`DELETE FROM public_article_files WHERE article_id = ?`, articleID)
	_, _ = pubDB.Exec(`DELETE FROM public_article_taxonomies WHERE article_id = ?`, articleID)
	_, err := pubDB.Exec(`DELETE FROM public_articles WHERE id = ?`, articleID)
	return err
}

func syncPublicTaxonomyUpdate(owner, taxID int64, ownerTax []articleTaxonomy) {
	pubDB := appkit.OpenDB("public")
	var exists int64
	if err := pubDB.QueryRow(`SELECT id FROM public_taxonomies WHERE id = ?`, taxID).Scan(&exists); err != nil {
		return
	}
	taxByID := make(map[int64]articleTaxonomy, len(ownerTax))
	for _, t := range ownerTax {
		taxByID[t.ID] = t
	}
	curr := taxID
	visited := map[int64]bool{}
	for curr != 0 && !visited[curr] {
		visited[curr] = true
		t, ok := taxByID[curr]
		if !ok {
			break
		}
		_, _ = pubDB.Exec(
			`INSERT INTO public_taxonomies(id, user_id, kind, name, parent_id, revision) VALUES(?, ?, ?, ?, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET name = excluded.name, parent_id = excluded.parent_id, revision = excluded.revision`,
			t.ID, owner, t.Kind, t.Name, t.ParentID, t.Revision,
		)
		curr = t.ParentID
	}
}

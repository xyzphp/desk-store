package main

import (
	"database/sql"
	"encoding/base64"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/xyzphp/desk-store/sdk/appkit"
)

const tempFileRefKey = "article:temp"

type articleFileMeta struct {
	FileID    int64
	UserID    int64
	Name      string
	MediaType string
	SizeBytes int64
	Width     int
	Height    int
	UpdatedAt int64
}

type articleFileView struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Kind       string `json:"kind"`
	ParentID   int64  `json:"parentId"`
	ProviderID int64  `json:"providerId"`
	MediaType  string `json:"mediaType"`
	Size       int64  `json:"size"`
	Width      int    `json:"width,omitempty"`
	Height     int    `json:"height,omitempty"`
	IsPublic   bool   `json:"isPublic"`
	TrashedAt  int64  `json:"trashedAt"`
}

func toArticleFileView(m articleFileMeta) articleFileView {
	return articleFileView{
		ID:        formatFileID(m.FileID),
		Name:      m.Name,
		Kind:      "file",
		MediaType: m.MediaType,
		Size:      m.SizeBytes,
		Width:     m.Width,
		Height:    m.Height,
	}
}

func articleRefKey(articleID int64) string {
	return "article:" + strconv.FormatInt(articleID, 10)
}

func upsertFileMeta(db *sql.DB, meta articleFileMeta) error {
	if meta.UpdatedAt == 0 {
		meta.UpdatedAt = time.Now().UnixMilli()
	}
	if meta.Name == "" {
		meta.Name = "file-" + strconv.FormatInt(meta.FileID, 10)
	}
	if meta.MediaType == "" {
		meta.MediaType = "application/octet-stream"
	}
	_, err := db.Exec(
		`INSERT INTO article_file_meta(file_id, user_id, name, media_type, size_bytes, width, height, updated_at)
		 VALUES(?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(file_id) DO UPDATE SET
		   name = excluded.name,
		   media_type = excluded.media_type,
		   size_bytes = excluded.size_bytes,
		   width = excluded.width,
		   height = excluded.height,
		   updated_at = excluded.updated_at`,
		meta.FileID, meta.UserID, meta.Name, meta.MediaType, meta.SizeBytes, meta.Width, meta.Height, meta.UpdatedAt,
	)
	return err
}

func loadFileMeta(db *sql.DB, fileID int64) (articleFileMeta, error) {
	var m articleFileMeta
	err := db.QueryRow(
		`SELECT file_id, user_id, name, media_type, size_bytes, width, height, updated_at FROM article_file_meta WHERE file_id = ?`,
		fileID,
	).Scan(&m.FileID, &m.UserID, &m.Name, &m.MediaType, &m.SizeBytes, &m.Width, &m.Height, &m.UpdatedAt)
	return m, err
}

func listOwnerFileMetaMap(db *sql.DB, owner int64) (map[int64]articleFileMeta, error) {
	rows, err := db.Query(
		`SELECT file_id, user_id, name, media_type, size_bytes, width, height, updated_at FROM article_file_meta WHERE user_id = ? ORDER BY updated_at DESC`,
		owner,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]articleFileMeta{}
	for rows.Next() {
		var m articleFileMeta
		if err := rows.Scan(&m.FileID, &m.UserID, &m.Name, &m.MediaType, &m.SizeBytes, &m.Width, &m.Height, &m.UpdatedAt); err != nil {
			return nil, err
		}
		out[m.FileID] = m
	}
	return out, rows.Err()
}

func listOwnerFileViews(db *sql.DB, owner int64) ([]articleFileView, error) {
	rows, err := db.Query(
		`SELECT file_id, user_id, name, media_type, size_bytes, width, height, updated_at FROM article_file_meta WHERE user_id = ? ORDER BY updated_at DESC LIMIT 2000`,
		owner,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []articleFileView{}
	for rows.Next() {
		var m articleFileMeta
		if err := rows.Scan(&m.FileID, &m.UserID, &m.Name, &m.MediaType, &m.SizeBytes, &m.Width, &m.Height, &m.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, toArticleFileView(m))
	}
	return items, rows.Err()
}

func loadArticleFileViews(db *sql.DB, owner int64, ids []int64) ([]articleFileView, error) {
	items := []articleFileView{}
	seen := map[int64]bool{}
	for _, id := range ids {
		if id <= 0 || seen[id] {
			continue
		}
		seen[id] = true
		m, err := loadFileMeta(db, id)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				// 尝试从宿主补充元信息
				if ref, rErr := appkit.FileReferenceRead(formatFileID(id), true); rErr == nil {
					m = articleFileMeta{
						FileID:    id,
						UserID:    owner,
						Name:      ref.Name,
						MediaType: ref.MediaType,
						SizeBytes: ref.Size,
						Width:     ref.Width,
						Height:    ref.Height,
						UpdatedAt: ref.UpdatedAt,
					}
					_ = upsertFileMeta(db, m)
				} else {
					continue
				}
			} else {
				return nil, err
			}
		}
		items = append(items, toArticleFileView(m))
	}
	return items, nil
}

// ensureOwnedFileMeta 校验文件可由当前作者引用：优先核对本地缓存归属，其次通过宿主 files.reference.add + read 验证。
func ensureOwnedFileMeta(db *sql.DB, owner, fileID int64) (articleFileMeta, error) {
	if fileID <= 0 {
		return articleFileMeta{}, errArticleInvalid
	}
	fidStr := formatFileID(fileID)
	m, err := loadFileMeta(db, fileID)
	if err == nil {
		if m.UserID != owner {
			return articleFileMeta{}, errArticleInvalid
		}
		// 复核宿主是否仍可读取（未删除）
		if ref, rErr := appkit.FileReferenceRead(fidStr, true); rErr == nil {
			m.Name = ref.Name
			m.MediaType = ref.MediaType
			m.SizeBytes = ref.Size
			if ref.Width > 0 {
				m.Width = ref.Width
			}
			if ref.Height > 0 {
				m.Height = ref.Height
			}
			_ = upsertFileMeta(db, m)
			return m, nil
		}
		// 如果此前尚未挂引用（或已释放），尝试以当前用户重新登记校验归属
		if err := appkit.FileReferenceAdd(fidStr, tempFileRefKey); err != nil {
			return articleFileMeta{}, errArticleInvalid
		}
		if ref, rErr := appkit.FileReferenceRead(fidStr, true); rErr == nil {
			m.Name = ref.Name
			m.MediaType = ref.MediaType
			m.SizeBytes = ref.Size
			if ref.Width > 0 {
				m.Width = ref.Width
			}
			if ref.Height > 0 {
				m.Height = ref.Height
			}
			_ = upsertFileMeta(db, m)
		}
		return m, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return articleFileMeta{}, err
	}
	// 尚未登记过的文件（例如个人令牌或 MCP 直接传了本人 fileId）：经宿主登记引用校验归属并取元信息
	if err := appkit.FileReferenceAdd(fidStr, tempFileRefKey); err != nil {
		return articleFileMeta{}, errArticleInvalid
	}
	ref, err := appkit.FileReferenceRead(fidStr, true)
	if err != nil {
		_ = appkit.FileReferenceRemove(fidStr, tempFileRefKey)
		return articleFileMeta{}, errArticleInvalid
	}
	m = articleFileMeta{
		FileID:    fileID,
		UserID:    owner,
		Name:      ref.Name,
		MediaType: ref.MediaType,
		SizeBytes: ref.Size,
		Width:     ref.Width,
		Height:    ref.Height,
		UpdatedAt: time.Now().UnixMilli(),
	}
	_ = upsertFileMeta(db, m)
	return m, nil
}

func listArticleFileIDs(db *sql.DB, articleID int64) ([]int64, error) {
	if articleID <= 0 {
		return nil, nil
	}
	rows, err := db.Query(`SELECT file_id FROM user_article_files WHERE article_id = ?`, articleID)
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

func syncArticleReferences(db *sql.DB, record articleRecord, prevFiles []int64) error {
	if _, err := db.Exec(`DELETE FROM user_article_files WHERE article_id = ?`, record.ID); err != nil {
		return err
	}
	draftFiles, publicFiles := map[int64]bool{}, map[int64]bool{}
	for _, id := range record.Draft.FileIDs {
		draftFiles[id] = true
	}
	if record.Draft.CoverFileID > 0 {
		draftFiles[record.Draft.CoverFileID] = true
	}
	if record.Published != nil {
		for _, id := range record.Published.FileIDs {
			publicFiles[id] = true
		}
		if record.Published.CoverFileID > 0 {
			publicFiles[record.Published.CoverFileID] = true
		}
	}
	all := map[int64]bool{}
	for id := range draftFiles {
		all[id] = true
	}
	for id := range publicFiles {
		all[id] = true
	}
	now := time.Now().UnixMilli()
	refKey := articleRefKey(record.ID)
	for id := range all {
		if _, err := db.Exec(
			`INSERT INTO user_article_files(article_id, file_id, draft_ref, published_ref, created_at) VALUES(?, ?, ?, ?, ?)`,
			record.ID, id, boolInt(draftFiles[id]), boolInt(publicFiles[id]), now,
		); err != nil {
			return err
		}
		fidStr := formatFileID(id)
		_ = appkit.FileReferenceAdd(fidStr, refKey)
		_ = appkit.FileReferenceRemove(fidStr, tempFileRefKey)
	}
	// 释放本文章不再引用的文件
	for _, oldID := range prevFiles {
		if !all[oldID] {
			fidStr := formatFileID(oldID)
			_ = appkit.FileReferenceRemove(fidStr, refKey)
			_ = appkit.FileReferenceRemove(fidStr, tempFileRefKey)
		}
	}

	if _, err := db.Exec(`DELETE FROM user_article_public_taxonomies WHERE article_id = ?`, record.ID); err != nil {
		return err
	}
	if record.Published != nil {
		ids := append([]int64{}, record.Published.TagIDs...)
		if record.Published.CategoryID != 0 {
			ids = append(ids, record.Published.CategoryID)
		}
		for _, tid := range ids {
			if _, err := db.Exec(`INSERT OR IGNORE INTO user_article_public_taxonomies(article_id, taxonomy_id) VALUES(?, ?)`, record.ID, tid); err != nil {
				return err
			}
		}
	}
	return nil
}

func releaseArticleFileReferences(articleID int64, fileIDs []int64) {
	refKey := articleRefKey(articleID)
	for _, fid := range fileIDs {
		fidStr := formatFileID(fid)
		_ = appkit.FileReferenceRemove(fidStr, refKey)
		_ = appkit.FileReferenceRemove(fidStr, tempFileRefKey)
	}
}

func handleListFiles(c *appkit.Context) {
	user, ok := requireUser(c)
	if !ok {
		return
	}
	db := appkit.OpenDB("shared")
	files, err := listOwnerFileViews(db, user.ID)
	if err != nil {
		articleAPIError(c, err)
		return
	}
	c.JSON(http.StatusOK, map[string]any{"ok": true, "files": files, "providers": []any{}})
}

func handleRegisterFile(c *appkit.Context) {
	user, ok := requireUser(c)
	if !ok {
		return
	}
	var req struct {
		FileID    string `json:"fileId"`
		Name      string `json:"name"`
		MediaType string `json:"mediaType"`
		Size      int64  `json:"size"`
		Width     int    `json:"width"`
		Height    int    `json:"height"`
	}
	if !decodeStrictJSON(c, &req, 16<<10) {
		return
	}
	fid, ok := parseNumericFileID(req.FileID)
	if !ok {
		articleAPIError(c, errArticleInvalid)
		return
	}
	fidStr := formatFileID(fid)
	if err := appkit.FileReferenceAdd(fidStr, tempFileRefKey); err != nil {
		c.Error(http.StatusBadRequest, "无法登记该文件的引用，请确认文件属于本人且未被删除")
		return
	}
	meta := articleFileMeta{
		FileID:    fid,
		UserID:    user.ID,
		Name:      strings.TrimSpace(req.Name),
		MediaType: strings.TrimSpace(req.MediaType),
		SizeBytes: req.Size,
		Width:     req.Width,
		Height:    req.Height,
		UpdatedAt: time.Now().UnixMilli(),
	}
	if ref, err := appkit.FileReferenceRead(fidStr, true); err == nil {
		if ref.Name != "" {
			meta.Name = ref.Name
		}
		if ref.MediaType != "" {
			meta.MediaType = ref.MediaType
		}
		if ref.Size > 0 {
			meta.SizeBytes = ref.Size
		}
		if ref.Width > 0 {
			meta.Width = ref.Width
		}
		if ref.Height > 0 {
			meta.Height = ref.Height
		}
	}
	db := appkit.OpenDB("shared")
	if err := upsertFileMeta(db, meta); err != nil {
		articleAPIError(c, err)
		return
	}
	c.JSON(http.StatusOK, map[string]any{"ok": true, "file": toArticleFileView(meta)})
}

func handleUploadFile(c *appkit.Context) {
	user, ok := requireUser(c)
	if !ok {
		return
	}
	var saved appkit.SavedFile
	if upload, err := c.ParseUpload(); err == nil && upload.Path != "" {
		res, saveErr := appkit.FileSave(upload.Filename, upload.Path, nil, tempFileRefKey)
		if saveErr != nil {
			c.Error(http.StatusBadRequest, saveErr.Error())
			return
		}
		saved = res
	} else {
		var req struct {
			Name       string `json:"name"`
			DataBase64 string `json:"dataBase64"`
		}
		if !decodeStrictJSON(c, &req, 1<<20) {
			return
		}
		data, err := base64.StdEncoding.DecodeString(strings.TrimSpace(req.DataBase64))
		if err != nil || len(data) == 0 {
			articleAPIError(c, errArticleInvalid)
			return
		}
		res, saveErr := appkit.FileSave(strings.TrimSpace(req.Name), "", data, tempFileRefKey)
		if saveErr != nil {
			c.Error(http.StatusBadRequest, saveErr.Error())
			return
		}
		saved = res
	}
	fid, ok := parseNumericFileID(saved.FileID)
	if !ok {
		articleAPIError(c, errArticleInvalid)
		return
	}
	meta := articleFileMeta{
		FileID:    fid,
		UserID:    user.ID,
		Name:      saved.Name,
		MediaType: saved.MediaType,
		SizeBytes: saved.Size,
		Width:     saved.Width,
		Height:    saved.Height,
		UpdatedAt: time.Now().UnixMilli(),
	}
	db := appkit.OpenDB("shared")
	if err := upsertFileMeta(db, meta); err != nil {
		articleAPIError(c, err)
		return
	}
	c.JSON(http.StatusCreated, map[string]any{"ok": true, "file": toArticleFileView(meta)})
}

func sendArticleFileResponse(c *appkit.Context, fileID int64, mediaType string) {
	inline := (mediaType == "image/png" || mediaType == "image/jpeg") && c.Query().Get("download") != "1"
	if !inline {
		c.SetHeader("content-type", "application/octet-stream")
	}
	c.SendUserFile(http.StatusOK, formatFileID(fileID), inline)
}

func handleFileContent(c *appkit.Context) {
	user, ok := requireUser(c)
	if !ok {
		return
	}
	fid, ok := parsePositiveID(c.Param("fileId"))
	if !ok {
		articleAPIError(c, sql.ErrNoRows)
		return
	}
	db := appkit.OpenDB("shared")
	meta, err := loadFileMeta(db, fid)
	allowed := err == nil && meta.UserID == user.ID
	if !allowed && c.HasPermission("site.settings") {
		var siteFile int64
		if db.QueryRow(`SELECT file_id FROM article_site_files WHERE site_id = 1 AND file_id = ?`, fid).Scan(&siteFile) == nil {
			allowed = true
		}
	}
	if !allowed {
		articleAPIError(c, sql.ErrNoRows)
		return
	}
	mediaType := meta.MediaType
	if mediaType == "" {
		if ref, rErr := appkit.FileReferenceRead(formatFileID(fid), true); rErr == nil {
			mediaType = ref.MediaType
		}
	}
	sendArticleFileResponse(c, fid, mediaType)
}

func handleArticleDraftFile(c *appkit.Context) {
	user, ok := requireUser(c)
	if !ok {
		return
	}
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
	db := appkit.OpenDB("shared")
	var owner int64
	if err := db.QueryRow(`SELECT user_id FROM user_articles WHERE id = ? AND user_id = ? AND trashed_at = 0`, articleID, user.ID).Scan(&owner); err != nil {
		articleAPIError(c, sql.ErrNoRows)
		return
	}
	var draftRef int
	if err := db.QueryRow(`SELECT draft_ref FROM user_article_files WHERE article_id = ? AND file_id = ? AND draft_ref = 1`, articleID, fid).Scan(&draftRef); err != nil {
		articleAPIError(c, sql.ErrNoRows)
		return
	}
	meta, _ := loadFileMeta(db, fid)
	mediaType := meta.MediaType
	if mediaType == "" {
		if ref, rErr := appkit.FileReferenceRead(formatFileID(fid), true); rErr == nil {
			mediaType = ref.MediaType
		}
	}
	sendArticleFileResponse(c, fid, mediaType)
}

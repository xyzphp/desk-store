package main

import (
	"database/sql"
	"errors"
	"net/http"

	"github.com/xyzphp/desk-store/sdk/appkit"
)

func handleToolListArticles(c *appkit.Context) {
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

func handleToolGetArticle(c *appkit.Context) {
	user, ok := requireUser(c)
	if !ok {
		return
	}
	var req struct {
		ID int64 `json:"id"`
	}
	if !decodeStrictJSON(c, &req, 4<<10) {
		return
	}
	if req.ID <= 0 {
		articleAPIError(c, errArticleInvalid)
		return
	}
	detail, err := getArticleDetail(user.ID, req.ID)
	if err != nil {
		articleAPIError(c, err)
		return
	}
	c.JSON(http.StatusOK, detail)
}

func handleToolCreateArticle(c *appkit.Context) {
	user, ok := requireUser(c)
	if !ok {
		return
	}
	var req struct {
		Action string       `json:"action"`
		Draft  articleDraft `json:"draft"`
	}
	if !decodeStrictJSON(c, &req, articleBodyMaxBytes) {
		return
	}
	if req.Action == "" {
		req.Action = "save"
	}
	record, status, err := saveArticleCore(user, 0, articleSaveRequest{
		Action: req.Action,
		Draft:  req.Draft,
	})
	if err != nil {
		if status == http.StatusBadRequest && !errors.Is(err, errArticleInvalid) {
			c.Error(http.StatusBadRequest, err.Error())
			return
		}
		articleAPIError(c, err)
		return
	}
	c.JSON(http.StatusOK, map[string]any{"ok": true, "article": record})
}

func handleToolSaveArticle(c *appkit.Context) {
	user, ok := requireUser(c)
	if !ok {
		return
	}
	var req struct {
		ID       int64        `json:"id"`
		Revision int64        `json:"revision"`
		Action   string       `json:"action"`
		Draft    articleDraft `json:"draft"`
	}
	if !decodeStrictJSON(c, &req, articleBodyMaxBytes) {
		return
	}
	if req.ID <= 0 || req.Revision <= 0 {
		articleAPIError(c, errArticleInvalid)
		return
	}
	record, status, err := saveArticleCore(user, req.ID, articleSaveRequest{
		Revision: req.Revision,
		Action:   req.Action,
		Draft:    req.Draft,
	})
	if err != nil {
		if status == http.StatusBadRequest && !errors.Is(err, errArticleInvalid) {
			c.Error(http.StatusBadRequest, err.Error())
			return
		}
		articleAPIError(c, err)
		return
	}
	c.JSON(http.StatusOK, map[string]any{"ok": true, "article": record})
}

func handleToolArticleAction(c *appkit.Context) {
	user, ok := requireUser(c)
	if !ok {
		return
	}
	var req struct {
		ID       int64  `json:"id"`
		Revision int64  `json:"revision"`
		Action   string `json:"action"`
	}
	if !decodeStrictJSON(c, &req, 4<<10) {
		return
	}
	if req.ID <= 0 || req.Revision <= 0 {
		articleAPIError(c, errArticleInvalid)
		return
	}
	runArticleAction(c, user, req.ID, articleActionRequest{
		Revision: req.Revision,
		Action:   req.Action,
	})
}

func handleToolSaveArticleTaxonomy(c *appkit.Context) {
	user, ok := requireUser(c)
	if !ok {
		return
	}
	var req taxonomyMutateRequest
	if !decodeStrictJSON(c, &req, 16<<10) {
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

func handleToolListArticleFiles(c *appkit.Context) {
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
	c.JSON(http.StatusOK, map[string]any{"ok": true, "files": files})
}

func handleResourceRecent(c *appkit.Context) {
	user, ok := requireUser(c)
	if !ok {
		return
	}
	db := appkit.OpenDB("shared")
	articles, err := listOwnerArticles(db, user.ID)
	if err != nil {
		articleAPIError(c, err)
		return
	}
	items := make([]map[string]any, 0, 20)
	for _, rec := range articles {
		if rec.TrashedAt != 0 {
			continue
		}
		items = append(items, articleSummary(rec))
		if len(items) >= 20 {
			break
		}
	}
	c.JSON(http.StatusOK, map[string]any{
		"ok":       true,
		"uri":      "articles://recent",
		"mimeType": "application/json",
		"items":    items,
	})
}

func handleResourceTaxonomies(c *appkit.Context) {
	user, ok := requireUser(c)
	if !ok {
		return
	}
	db := appkit.OpenDB("shared")
	taxonomies, err := listOwnerTaxonomies(db, user.ID)
	if err != nil {
		articleAPIError(c, err)
		return
	}
	c.JSON(http.StatusOK, map[string]any{
		"ok":         true,
		"uri":        "articles://taxonomies",
		"mimeType":   "application/json",
		"taxonomies": taxonomies,
	})
}

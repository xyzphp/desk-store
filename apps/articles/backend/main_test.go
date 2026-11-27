package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/xyzphp/desk-store/sdk/apphost"
	"github.com/xyzphp/desk-store/sdk/appkit"
)

var samplePNG = []byte{
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
	0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
	0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
	0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
	0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d,
	0xb0, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
	0x44, 0xae, 0x42, 0x60, 0x82,
}

func newTestHost(t *testing.T, opts ...apphost.Option) *apphost.Host {
	t.Helper()
	h, err := apphost.NewFromAppDir("..", opts...)
	if err != nil {
		t.Fatalf("NewFromAppDir: %v", err)
	}
	t.Cleanup(h.Close)
	return h
}

func doReq(t *testing.T, h *apphost.Host, method, path, query string, body any, ctx appkit.RequestContext) appkit.ResponseEnvelope {
	t.Helper()
	var bodyB64 string
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		bodyB64 = base64.StdEncoding.EncodeToString(raw)
	}
	resp, err := h.Do(appkit.RequestEnvelope{
		Method:  method,
		Path:    path,
		Query:   query,
		Headers: map[string]string{"content-type": "application/json"},
		BodyB64: bodyB64,
		Context: ctx,
	}, buildRouter())
	if err != nil {
		t.Fatalf("Host.Do(%s %s): %v", method, path, err)
	}
	return resp
}

func decodeResp(t *testing.T, resp appkit.ResponseEnvelope) map[string]any {
	t.Helper()
	raw, err := base64.StdEncoding.DecodeString(resp.BodyB64)
	if err != nil {
		t.Fatalf("decode response base64: %v", err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal response JSON (%q): %v", string(raw), err)
	}
	return out
}

func decodeBodyText(t *testing.T, resp appkit.ResponseEnvelope) string {
	t.Helper()
	raw, err := base64.StdEncoding.DecodeString(resp.BodyB64)
	if err != nil {
		t.Fatalf("decode body: %v", err)
	}
	return string(raw)
}

func userCtx(id int64, name string, perms ...string) appkit.RequestContext {
	return appkit.RequestContext{
		Entry:       "window",
		User:        &appkit.User{ID: id, DisplayName: name},
		Permissions: perms,
		Visibility:  "app",
	}
}

func publicCtx(user *appkit.User) appkit.RequestContext {
	return appkit.RequestContext{
		Entry:      "public",
		User:       user,
		Visibility: "public",
	}
}

func TestArticlesDraftPublishedRevisionAndLimits(t *testing.T) {
	h := newTestHost(t)
	alice := userCtx(1, "Alice")

	// 新建草稿（未发布）
	resp := doReq(t, h, http.MethodPost, "/articles", "", map[string]any{
		"action": "save",
		"draft": map[string]any{
			"title":      "第一篇草稿",
			"summary":    "草稿摘要",
			"content":    "初稿内容",
			"categoryId": 0,
			"tagIds":     []int64{},
			"fileIds":    []int64{},
			"visibility": "public",
		},
	}, alice)
	if resp.Status != http.StatusCreated {
		t.Fatalf("create draft status = %d, want 201 (%s)", resp.Status, decodeBodyText(t, resp))
	}
	created := decodeResp(t, resp)["article"].(map[string]any)
	articleID := int64(created["id"].(float64))

	// 草稿不可在公开站读取
	pubResp := doReq(t, h, http.MethodGet, "/public/articles/"+strconv.FormatInt(articleID, 10), "", nil, publicCtx(nil))
	if pubResp.Status != http.StatusNotFound {
		t.Fatalf("unpublished draft public status = %d, want 404", pubResp.Status)
	}

	// 发布文章
	resp = doReq(t, h, http.MethodPut, "/articles/"+strconv.FormatInt(articleID, 10), "", map[string]any{
		"revision": 1,
		"action":   "publish",
		"draft": map[string]any{
			"title":      "公开文章 v1",
			"summary":    "公开摘要",
			"content":    "已发布正文 v1",
			"categoryId": 0,
			"tagIds":     []int64{},
			"fileIds":    []int64{},
			"visibility": "public",
		},
	}, alice)
	if resp.Status != http.StatusOK {
		t.Fatalf("publish status = %d, want 200 (%s)", resp.Status, decodeBodyText(t, resp))
	}

	// 再保存草稿（不发布），公开站仍应看到 v1 快照
	resp = doReq(t, h, http.MethodPut, "/articles/"+strconv.FormatInt(articleID, 10), "", map[string]any{
		"revision": 2,
		"action":   "save",
		"draft": map[string]any{
			"title":      "草稿修改 v2",
			"summary":    "草稿摘要 v2",
			"content":    "未发布的草稿正文 v2",
			"categoryId": 0,
			"tagIds":     []int64{},
			"fileIds":    []int64{},
			"visibility": "public",
		},
	}, alice)
	if resp.Status != http.StatusOK {
		t.Fatalf("save v2 draft status = %d, want 200", resp.Status)
	}

	pubResp = doReq(t, h, http.MethodGet, "/public/articles/"+strconv.FormatInt(articleID, 10), "", nil, publicCtx(nil))
	if pubResp.Status != http.StatusOK {
		t.Fatalf("public detail status = %d, want 200", pubResp.Status)
	}
	pubArt := decodeResp(t, pubResp)["article"].(map[string]any)
	if pubArt["title"] != "公开文章 v1" || pubArt["content"] != "已发布正文 v1" {
		t.Fatalf("public snapshot leaked draft: %+v", pubArt)
	}

	// 旧修订号冲突 -> 409
	resp = doReq(t, h, http.MethodPut, "/articles/"+strconv.FormatInt(articleID, 10), "", map[string]any{
		"revision": 1,
		"action":   "save",
		"draft": map[string]any{
			"title":      "过期修改",
			"summary":    "",
			"content":    "stale",
			"categoryId": 0,
			"tagIds":     []int64{},
			"fileIds":    []int64{},
			"visibility": "public",
		},
	}, alice)
	if resp.Status != http.StatusConflict {
		t.Fatalf("stale revision status = %d, want 409", resp.Status)
	}

	// 超过 12 个标签 -> 400
	tooManyTags := make([]int64, 13)
	for i := range tooManyTags {
		tooManyTags[i] = int64(i + 1)
	}
	resp = doReq(t, h, http.MethodPut, "/articles/"+strconv.FormatInt(articleID, 10), "", map[string]any{
		"revision": 3,
		"action":   "save",
		"draft": map[string]any{
			"title":      "超限标签",
			"summary":    "",
			"content":    "body",
			"categoryId": 0,
			"tagIds":     tooManyTags,
			"fileIds":    []int64{},
			"visibility": "private",
		},
	}, alice)
	if resp.Status != http.StatusBadRequest {
		t.Fatalf(">12 tags status = %d, want 400", resp.Status)
	}

	// 撤回发布后公开地址失效
	resp = doReq(t, h, http.MethodPost, "/articles/"+strconv.FormatInt(articleID, 10)+"/actions", "", map[string]any{
		"revision": 3,
		"action":   "unpublish",
	}, alice)
	if resp.Status != http.StatusOK {
		t.Fatalf("unpublish status = %d, want 200", resp.Status)
	}
	pubResp = doReq(t, h, http.MethodGet, "/public/articles/"+strconv.FormatInt(articleID, 10), "", nil, publicCtx(nil))
	if pubResp.Status != http.StatusNotFound {
		t.Fatalf("unpublished article still accessible: %d", pubResp.Status)
	}

	// 移入回收站 -> 恢复 -> 再次移入回收站 -> 永久删除
	for _, tc := range []struct {
		rev    int64
		action string
	}{
		{4, "trash"},
		{5, "restore"},
		{6, "trash"},
		{7, "delete"},
	} {
		resp = doReq(t, h, http.MethodPost, "/articles/"+strconv.FormatInt(articleID, 10)+"/actions", "", map[string]any{
			"revision": tc.rev,
			"action":   tc.action,
		}, alice)
		if resp.Status != http.StatusOK {
			t.Fatalf("action %s rev %d status = %d (%s)", tc.action, tc.rev, resp.Status, decodeBodyText(t, resp))
		}
	}
	getResp := doReq(t, h, http.MethodGet, "/articles/"+strconv.FormatInt(articleID, 10), "", nil, alice)
	if getResp.Status != http.StatusNotFound {
		t.Fatalf("deleted article status = %d, want 404", getResp.Status)
	}
}

func TestTaxonomiesTreeCycleAndInUseProtection(t *testing.T) {
	h := newTestHost(t)
	alice := userCtx(1, "Alice")

	createTax := func(kind, name string, parentID int64) int64 {
		resp := doReq(t, h, http.MethodPost, "/taxonomies", "", map[string]any{
			"id": 0, "revision": 0, "kind": kind, "name": name, "parentId": parentID, "action": "save",
		}, alice)
		if resp.Status != http.StatusOK {
			t.Fatalf("create %s %s status=%d (%s)", kind, name, resp.Status, decodeBodyText(t, resp))
		}
		return int64(decodeResp(t, resp)["id"].(float64))
	}

	l1 := createTax("category", "技术", 0)
	l2 := createTax("category", "后端", l1)
	l3 := createTax("category", "Go", l2)

	// 第 4 级分类被拒绝
	resp := doReq(t, h, http.MethodPost, "/taxonomies", "", map[string]any{
		"id": 0, "revision": 0, "kind": "category", "name": "第四级", "parentId": l3, "action": "save",
	}, alice)
	if resp.Status != http.StatusBadRequest {
		t.Fatalf("level 4 category status = %d, want 400", resp.Status)
	}

	// 将 L1 的父级设为子孙 L2（成环）被拒绝
	resp = doReq(t, h, http.MethodPost, "/taxonomies", "", map[string]any{
		"id": l1, "revision": 1, "kind": "category", "name": "技术", "parentId": l2, "action": "save",
	}, alice)
	if resp.Status != http.StatusBadRequest {
		t.Fatalf("cycle category status = %d, want 400", resp.Status)
	}

	// 含子分类不能删除
	resp = doReq(t, h, http.MethodPost, "/taxonomies", "", map[string]any{
		"id": l1, "revision": 1, "kind": "category", "name": "技术", "parentId": 0, "action": "delete",
	}, alice)
	if resp.Status != http.StatusConflict {
		t.Fatalf("delete parent with children status = %d, want 409", resp.Status)
	}

	// 文章使用 L3 后不能删除 L3
	tagID := createTax("tag", "Wasm", 0)
	artResp := doReq(t, h, http.MethodPost, "/articles", "", map[string]any{
		"action": "publish",
		"draft": map[string]any{
			"title":      "三级分类文章",
			"summary":    "",
			"content":    "内容",
			"categoryId": l3,
			"tagIds":     []int64{tagID},
			"fileIds":    []int64{},
			"visibility": "public",
		},
	}, alice)
	if artResp.Status != http.StatusCreated {
		t.Fatalf("publish status = %d", artResp.Status)
	}

	resp = doReq(t, h, http.MethodPost, "/taxonomies", "", map[string]any{
		"id": l3, "revision": 1, "kind": "category", "name": "Go", "parentId": l2, "action": "delete",
	}, alice)
	if resp.Status != http.StatusConflict {
		t.Fatalf("delete in-use category status = %d, want 409", resp.Status)
	}

	// 公开站按父分类 L1 筛选可命中 L3 子分类文章
	listResp := doReq(t, h, http.MethodGet, "/public/articles", "taxonomy="+strconv.FormatInt(l1, 10), nil, publicCtx(nil))
	if listResp.Status != http.StatusOK {
		t.Fatalf("public filter by ancestor status = %d", listResp.Status)
	}
	listData := decodeResp(t, listResp)
	if int(listData["total"].(float64)) != 1 {
		t.Fatalf("public filter by L1 total = %v, want 1", listData["total"])
	}
}

func TestAuthorIsolationAndFileLifecycle(t *testing.T) {
	h := newTestHost(t, apphost.WithReferencedFiles(map[string]apphost.ReferencedFile{
		"file:101": {Name: "cover.png", MediaType: "image/png", Data: samplePNG},
		"file:102": {Name: "doc.pdf", MediaType: "application/pdf", Data: []byte("%PDF-1.4")},
	}))
	alice := userCtx(1, "Alice")
	bob := userCtx(2, "Bob")

	// Alice 登记文件
	reg := doReq(t, h, http.MethodPost, "/files/register", "", map[string]any{
		"fileId": "file:101", "name": "cover.png", "mediaType": "image/png", "size": len(samplePNG), "width": 1200, "height": 630,
	}, alice)
	if reg.Status != http.StatusOK {
		t.Fatalf("register file status = %d (%s)", reg.Status, decodeBodyText(t, reg))
	}

	// Alice 创建仅保存草稿的文章引用 101，Bob 不可读，匿名不可读
	artResp := doReq(t, h, http.MethodPost, "/articles", "", map[string]any{
		"action": "save",
		"draft": map[string]any{
			"title":       "带图草稿",
			"summary":     "",
			"content":     "![配图](article-file:101)",
			"categoryId":  0,
			"coverFileId": 101,
			"tagIds":      []int64{},
			"fileIds":     []int64{101},
			"visibility":  "public",
		},
	}, alice)
	if artResp.Status != http.StatusCreated {
		t.Fatalf("create draft with file status = %d (%s)", artResp.Status, decodeBodyText(t, artResp))
	}
	artID := int64(decodeResp(t, artResp)["article"].(map[string]any)["id"].(float64))

	if r := doReq(t, h, http.MethodGet, "/articles/"+strconv.FormatInt(artID, 10), "", nil, bob); r.Status != http.StatusNotFound {
		t.Fatalf("bob reading alice article status = %d, want 404", r.Status)
	}
	if r := doReq(t, h, http.MethodGet, "/files/content/101", "", nil, bob); r.Status != http.StatusNotFound {
		t.Fatalf("bob reading alice file status = %d, want 404", r.Status)
	}
	if r := doReq(t, h, http.MethodGet, "/public/articles/"+strconv.FormatInt(artID, 10)+"/files/101", "", nil, publicCtx(nil)); r.Status != http.StatusNotFound {
		t.Fatalf("anonymous reading unpublished file status = %d, want 404", r.Status)
	}

	// 发布后公开可读图片（inline）与非图片附件（application/octet-stream）
	doReq(t, h, http.MethodPost, "/files/register", "", map[string]any{
		"fileId": "file:102", "name": "doc.pdf", "mediaType": "application/pdf", "size": 8,
	}, alice)
	pub := doReq(t, h, http.MethodPut, "/articles/"+strconv.FormatInt(artID, 10), "", map[string]any{
		"revision": 1,
		"action":   "publish",
		"draft": map[string]any{
			"title":       "带图公开文章",
			"summary":     "",
			"content":     "![配图](article-file:101)\n[下载](article-file:102)",
			"categoryId":  0,
			"coverFileId": 101,
			"tagIds":      []int64{},
			"fileIds":     []int64{101, 102},
			"visibility":  "public",
		},
	}, alice)
	if pub.Status != http.StatusOK {
		t.Fatalf("publish with files status = %d", pub.Status)
	}

	imgResp := doReq(t, h, http.MethodGet, "/public/articles/"+strconv.FormatInt(artID, 10)+"/files/101", "", nil, publicCtx(nil))
	if imgResp.Status != http.StatusOK || imgResp.SendFile != "file:101" {
		t.Fatalf("public image response = (%d, send_file=%q)", imgResp.Status, imgResp.SendFile)
	}
	pdfResp := doReq(t, h, http.MethodGet, "/public/articles/"+strconv.FormatInt(artID, 10)+"/files/102", "", nil, publicCtx(nil))
	if pdfResp.Status != http.StatusOK || pdfResp.SendFile != "file:102" || pdfResp.Headers["content-type"] != "application/octet-stream" {
		t.Fatalf("public pdf response = (%d, send_file=%q, ct=%q)", pdfResp.Status, pdfResp.SendFile, pdfResp.Headers["content-type"])
	}
}

func TestPublicThreePerspectivesSSRAndFeeds(t *testing.T) {
	h := newTestHost(t)
	alice := userCtx(1, "Alice")

	// 1 篇公开 + 1 篇私有发布
	pubArt := doReq(t, h, http.MethodPost, "/articles", "", map[string]any{
		"action": "publish",
		"draft": map[string]any{
			"title": "公开文章", "summary": "对外可见", "content": "公开正文",
			"categoryId": 0, "tagIds": []int64{}, "fileIds": []int64{}, "visibility": "public",
		},
	}, alice)
	pubID := int64(decodeResp(t, pubArt)["article"].(map[string]any)["id"].(float64))

	privArt := doReq(t, h, http.MethodPost, "/articles", "", map[string]any{
		"action": "publish",
		"draft": map[string]any{
			"title": "私有文章", "summary": "仅作者可见", "content": "私有正文",
			"categoryId": 0, "tagIds": []int64{}, "fileIds": []int64{}, "visibility": "private",
		},
	}, alice)
	privID := int64(decodeResp(t, privArt)["article"].(map[string]any)["id"].(float64))

	// 视角 1：匿名只看到 1 篇
	anonList := decodeResp(t, doReq(t, h, http.MethodGet, "/public/articles", "", nil, publicCtx(nil)))
	if int(anonList["total"].(float64)) != 1 || anonList["privateAccess"].(bool) {
		t.Fatalf("anonymous list = %+v", anonList)
	}

	// 视角 2：作者本人看到 2 篇
	authorList := decodeResp(t, doReq(t, h, http.MethodGet, "/public/articles", "", nil, publicCtx(&appkit.User{ID: 1, DisplayName: "Alice"})))
	if int(authorList["total"].(float64)) != 2 || !authorList["privateAccess"].(bool) {
		t.Fatalf("author list = %+v", authorList)
	}

	// 视角 3：其他登录用户 Bob 只看到 1 篇，不能看 Alice 私有文章
	bobUser := &appkit.User{ID: 2, DisplayName: "Bob"}
	bobList := decodeResp(t, doReq(t, h, http.MethodGet, "/public/articles", "", nil, publicCtx(bobUser)))
	if int(bobList["total"].(float64)) != 1 {
		t.Fatalf("bob list total = %v, want 1", bobList["total"])
	}
	if r := doReq(t, h, http.MethodGet, "/public/articles/"+strconv.FormatInt(privID, 10), "", nil, publicCtx(bobUser)); r.Status != http.StatusNotFound {
		t.Fatalf("bob reading alice private article = %d, want 404", r.Status)
	}

	// SSR 校验：公开文章 200 且含 desk-ui 标记；匿名访问私有文章 404；作者访问私有文章 200
	ssrPub := doReq(t, h, http.MethodGet, "/public/ssr/"+strconv.FormatInt(pubID, 10), "", nil, publicCtx(nil))
	if ssrPub.Status != http.StatusOK || !strings.Contains(decodeBodyText(t, ssrPub), `name="xyzos-desk-ui"`) {
		t.Fatalf("ssr public status=%d", ssrPub.Status)
	}
	ssrPrivAnon := doReq(t, h, http.MethodGet, "/public/ssr/"+strconv.FormatInt(privID, 10), "", nil, publicCtx(nil))
	if ssrPrivAnon.Status != http.StatusNotFound {
		t.Fatalf("ssr private anonymous status = %d, want 404", ssrPrivAnon.Status)
	}
	ssrPrivAuthor := doReq(t, h, http.MethodGet, "/public/ssr/"+strconv.FormatInt(privID, 10), "", nil, publicCtx(&appkit.User{ID: 1, DisplayName: "Alice"}))
	if ssrPrivAuthor.Status != http.StatusOK {
		t.Fatalf("ssr private author status = %d, want 200", ssrPrivAuthor.Status)
	}

	// RSS & Sitemap 不得包含私有文章
	rssBody := decodeBodyText(t, doReq(t, h, http.MethodGet, "/public/rss.xml", "", nil, publicCtx(&appkit.User{ID: 1, DisplayName: "Alice"})))
	if !strings.Contains(rssBody, "公开文章") || strings.Contains(rssBody, "私有文章") {
		t.Fatalf("rss leak or missing: %s", rssBody)
	}
	smBody := decodeBodyText(t, doReq(t, h, http.MethodGet, "/public/sitemap.xml", "", nil, publicCtx(&appkit.User{ID: 1, DisplayName: "Alice"})))
	if !strings.Contains(smBody, "/articles/"+strconv.FormatInt(pubID, 10)) || strings.Contains(smBody, "/articles/"+strconv.FormatInt(privID, 10)) {
		t.Fatalf("sitemap leak or missing: %s", smBody)
	}
}

func TestTokenEntryScopeIsolation(t *testing.T) {
	h := newTestHost(t)
	tokCtx := appkit.RequestContext{
		Entry:      "token",
		User:       &appkit.User{ID: 1, DisplayName: "Alice"},
		Visibility: "app",
	}

	// 令牌在 POST /articles 中带 action=publish 必须被拒（需要 /publish/:id）
	resp := doReq(t, h, http.MethodPost, "/articles", "", map[string]any{
		"action": "publish",
		"draft": map[string]any{
			"title": "标题", "summary": "", "content": "正文",
			"categoryId": 0, "tagIds": []int64{}, "fileIds": []int64{}, "visibility": "public",
		},
	}, tokCtx)
	if resp.Status != http.StatusForbidden {
		t.Fatalf("token publish via POST /articles = %d, want 403", resp.Status)
	}

	// 保存草稿成功，随后通过 /publish/:id 发布成功
	resp = doReq(t, h, http.MethodPost, "/articles", "", map[string]any{
		"action": "save",
		"draft": map[string]any{
			"title": "标题", "summary": "", "content": "正文",
			"categoryId": 0, "tagIds": []int64{}, "fileIds": []int64{}, "visibility": "public",
		},
	}, tokCtx)
	if resp.Status != http.StatusCreated {
		t.Fatalf("token save draft = %d, want 201", resp.Status)
	}
	artID := int64(decodeResp(t, resp)["article"].(map[string]any)["id"].(float64))

	resp = doReq(t, h, http.MethodPost, "/publish/"+strconv.FormatInt(artID, 10), "", map[string]any{
		"revision": 1,
		"action":   "publish",
		"draft": map[string]any{
			"title": "标题", "summary": "", "content": "正文",
			"categoryId": 0, "tagIds": []int64{}, "fileIds": []int64{}, "visibility": "public",
		},
	}, tokCtx)
	if resp.Status != http.StatusOK {
		t.Fatalf("token publish via /publish/:id = %d, want 200", resp.Status)
	}

	// 令牌在 /articles/:id/actions 传 unpublish 必须被拒（需 /publish/:id/unpublish）
	resp = doReq(t, h, http.MethodPost, "/articles/"+strconv.FormatInt(artID, 10)+"/actions", "", map[string]any{
		"revision": 2, "action": "unpublish",
	}, tokCtx)
	if resp.Status != http.StatusForbidden {
		t.Fatalf("token unpublish via /actions = %d, want 403", resp.Status)
	}

	// 令牌删除分类通过 POST /taxonomies 必须被拒（需 DELETE /taxonomies/:id）
	taxResp := doReq(t, h, http.MethodPost, "/taxonomies", "", map[string]any{
		"id": 0, "revision": 0, "kind": "tag", "name": "标签", "parentId": 0, "action": "save",
	}, tokCtx)
	taxID := int64(decodeResp(t, taxResp)["id"].(float64))
	resp = doReq(t, h, http.MethodPost, "/taxonomies", "", map[string]any{
		"id": taxID, "revision": 1, "kind": "tag", "name": "标签", "parentId": 0, "action": "delete",
	}, tokCtx)
	if resp.Status != http.StatusForbidden {
		t.Fatalf("token delete taxonomy via POST = %d, want 403", resp.Status)
	}
	resp = doReq(t, h, http.MethodDelete, "/taxonomies/"+strconv.FormatInt(taxID, 10), "revision=1&kind=tag", nil, tokCtx)
	if resp.Status != http.StatusOK {
		t.Fatalf("token delete taxonomy via DELETE = %d, want 200", resp.Status)
	}
}

func TestSiteSettingsAndQuotes(t *testing.T) {
	failFetch := false
	h := newTestHost(t,
		apphost.WithReferencedFiles(map[string]apphost.ReferencedFile{
			"file:201": {Name: "logo.png", MediaType: "image/png", Data: samplePNG},
		}),
		apphost.WithHTTPHandler(func(req appkit.HTTPRequest) (appkit.HTTPResponse, error) {
			if failFetch {
				return appkit.HTTPResponse{}, errors.New("dial timeout")
			}
			return appkit.HTTPResponse{
				Status:  http.StatusOK,
				Headers: map[string]string{"content-type": "application/json; charset=utf-8"},
				Body:    []byte(`{"hitokoto":"今日事今日毕"}`),
			}, nil
		}),
	)

	member := userCtx(2, "Member")
	admin := userCtx(1, "Admin", "site.settings")

	// 无 site.settings 权限被拒
	if r := doReq(t, h, http.MethodGet, "/site", "", nil, member); r.Status != http.StatusForbidden {
		t.Fatalf("member GET /site = %d, want 403", r.Status)
	}

	// Admin 登记 logo 并保存站点配置
	doReq(t, h, http.MethodPost, "/files/register", "", map[string]any{
		"fileId": "file:201", "name": "logo.png", "mediaType": "image/png", "size": len(samplePNG),
	}, admin)

	cfg := defaultArticleSiteConfig()
	cfg.Name = "我的博客"
	cfg.LogoImage = 201
	cfg.Quote = articleQuoteConfig{
		Mode:   "api",
		URL:    "https://v1.hitokoto.cn/?encode=json",
		Format: "json",
		Field:  "hitokoto",
	}
	saveResp := doReq(t, h, http.MethodPut, "/site", "", articleSiteRecord{Config: cfg, Revision: 0}, admin)
	if saveResp.Status != http.StatusOK {
		t.Fatalf("PUT /site = %d (%s)", saveResp.Status, decodeBodyText(t, saveResp))
	}

	// 旧修订号冲突 -> 409
	if r := doReq(t, h, http.MethodPut, "/site", "", articleSiteRecord{Config: cfg, Revision: 0}, admin); r.Status != http.StatusConflict {
		t.Fatalf("stale PUT /site = %d, want 409", r.Status)
	}

	// 公开站点配置不泄露上游一言 URL / 字段
	pubSite := decodeResp(t, doReq(t, h, http.MethodGet, "/public/site", "", nil, publicCtx(nil)))
	quoteCfg := pubSite["site"].(map[string]any)["config"].(map[string]any)["quote"].(map[string]any)
	if quoteCfg["mode"] != "api" || quoteCfg["url"] != nil || quoteCfg["field"] != nil {
		t.Fatalf("public site leaked quote config: %+v", quoteCfg)
	}

	// 站点图片在公开站可读
	siteImg := doReq(t, h, http.MethodGet, "/public/site/files/201", "", nil, publicCtx(nil))
	if siteImg.Status != http.StatusOK || siteImg.SendFile != "file:201" {
		t.Fatalf("public site file = (%d, %q)", siteImg.Status, siteImg.SendFile)
	}

	// 定时任务拉取每日一言并同步公开站
	schedResp := doReq(t, h, http.MethodPost, "/jobs/daily-quote", "", map[string]any{
		"schedule": "daily-quote", "triggered_at": time.Now().UnixMilli(),
	}, appkit.RequestContext{Entry: "schedule", Visibility: "app"})
	if schedResp.Status != http.StatusOK {
		t.Fatalf("daily quote schedule = %d (%s)", schedResp.Status, decodeBodyText(t, schedResp))
	}

	pubQuote := decodeResp(t, doReq(t, h, http.MethodGet, "/public/site/quote", "", nil, publicCtx(nil)))
	if pubQuote["text"] != "今日事今日毕" {
		t.Fatalf("public quote text = %v, want 今日事今日毕", pubQuote["text"])
	}

	// 手动编辑当日一言
	today := articleQuoteDay(time.Now())
	editResp := doReq(t, h, http.MethodPost, "/site/quotes", "", map[string]any{
		"action": "edit", "day": today, "text": "人工修订的一言", "revision": 2,
	}, admin)
	if editResp.Status != http.StatusOK {
		t.Fatalf("edit quote = %d (%s)", editResp.Status, decodeBodyText(t, editResp))
	}
	pubQuote = decodeResp(t, doReq(t, h, http.MethodGet, "/public/site/quote", "", nil, publicCtx(nil)))
	if pubQuote["text"] != "人工修订的一言" {
		t.Fatalf("edited quote text = %v", pubQuote["text"])
	}

	// 再次拉取失败时保留旧文案并返回 failure
	failFetch = true
	retryResp := doReq(t, h, http.MethodPost, "/site/quotes", "", map[string]any{
		"action": "fetch", "day": today, "text": "", "revision": 3,
	}, admin)
	if retryResp.Status != http.StatusOK {
		t.Fatalf("retry fetch quote = %d", retryResp.Status)
	}
	retryData := decodeResp(t, retryResp)
	if retryData["failure"] == nil {
		t.Fatalf("expected failure object on fetch error")
	}
	if retryData["item"].(map[string]any)["text"] != "人工修订的一言" {
		t.Fatalf("failed fetch overwrote existing quote text")
	}
}

func TestBuiltinImportPayload(t *testing.T) {
	h := newTestHost(t, apphost.WithReferencedFiles(map[string]apphost.ReferencedFile{
		"file:301": {Name: "imported-logo.png", MediaType: "image/png", Data: samplePNG},
	}))

	cfg := defaultArticleSiteConfig()
	cfg.Name = "原内置站点"
	cfg.LogoImage = 301
	cfg.AvatarImage = 999 // 缺失图片，应在导入时清零

	payload := map[string]any{
		"source":      "articles.site",
		"exported_at": time.Now().UnixMilli(),
		"data": map[string]any{
			"configured": true,
			"config":     cfg,
			"revision":   5,
			"updated_at": time.Now().UnixMilli(),
			"files": []map[string]any{
				{"file_id": "file:301", "name": "imported-logo.png", "media_type": "image/png", "size": len(samplePNG), "width": 128, "height": 128},
			},
			"quotes": []map[string]any{
				{"day": "2026-11-26", "text": "旧站导入的一言", "status": "ready", "source": "api", "fetched_at": 1700000000000, "updated_at": 1700000000000},
			},
			"missing_files": []string{"file:999"},
		},
	}

	impResp := doReq(t, h, http.MethodPost, "/import/builtin", "", payload, appkit.RequestContext{
		Entry:       "import",
		User:        &appkit.User{ID: 1, DisplayName: "Admin"},
		Permissions: []string{"site.settings"},
		Visibility:  "permission:site.settings",
	})
	if impResp.Status != http.StatusOK {
		t.Fatalf("builtin import status = %d (%s)", impResp.Status, decodeBodyText(t, impResp))
	}

	// 回读验证：名称同步，缺失头像已清零，保留的 logo 可在公开站读取，一言可回读
	siteData := decodeResp(t, doReq(t, h, http.MethodGet, "/public/site", "", nil, publicCtx(nil)))
	siteCfg := siteData["site"].(map[string]any)["config"].(map[string]any)
	if siteCfg["name"] != "原内置站点" || int(siteCfg["logoImage"].(float64)) != 301 || int(siteCfg["avatarImage"].(float64)) != 0 {
		t.Fatalf("imported site config mismatch: %+v", siteCfg)
	}
	logoResp := doReq(t, h, http.MethodGet, "/public/site/files/301", "", nil, publicCtx(nil))
	if logoResp.Status != http.StatusOK || logoResp.SendFile != "file:301" {
		t.Fatalf("imported logo public read = (%d, %q)", logoResp.Status, logoResp.SendFile)
	}
	quotesResp := decodeResp(t, doReq(t, h, http.MethodGet, "/public/site/quote", "", nil, publicCtx(nil)))
	items := quotesResp["items"].([]any)
	if len(items) != 1 || items[0].(map[string]any)["text"] != "旧站导入的一言" {
		t.Fatalf("imported quotes mismatch: %+v", items)
	}
}

func TestMCPToolsAndResources(t *testing.T) {
	h := newTestHost(t)
	mcpCtx := appkit.RequestContext{
		Entry:      "mcp",
		User:       &appkit.User{ID: 1, DisplayName: "Alice"},
		Visibility: "app",
	}

	// 创建分类与文章
	taxResp := doReq(t, h, http.MethodPost, "/tools/save-article-taxonomy", "", map[string]any{
		"id": 0, "revision": 0, "kind": "category", "name": "笔记", "parentId": 0, "action": "save",
	}, mcpCtx)
	if taxResp.Status != http.StatusOK {
		t.Fatalf("tool save taxonomy = %d", taxResp.Status)
	}
	catID := int64(decodeResp(t, taxResp)["id"].(float64))

	createResp := doReq(t, h, http.MethodPost, "/tools/create-article", "", map[string]any{
		"action": "save",
		"draft": map[string]any{
			"title": "MCP 草稿", "summary": "摘要", "content": "正文",
			"categoryId": catID, "coverFileId": 0, "tagIds": []int64{}, "fileIds": []int64{}, "visibility": "private",
		},
	}, mcpCtx)
	if createResp.Status != http.StatusOK {
		t.Fatalf("tool create article = %d (%s)", createResp.Status, decodeBodyText(t, createResp))
	}
	artID := int64(decodeResp(t, createResp)["article"].(map[string]any)["id"].(float64))

	// 读取列表、详情、文件列表与两个只读资源
	for _, path := range []string{"/tools/list-articles", "/tools/list-article-files", "/resources/recent", "/resources/taxonomies"} {
		if r := doReq(t, h, http.MethodPost, path, "", map[string]any{}, mcpCtx); r.Status != http.StatusOK {
			t.Fatalf("POST %s = %d (%s)", path, r.Status, decodeBodyText(t, r))
		}
	}
	getResp := doReq(t, h, http.MethodPost, "/tools/get-article", "", map[string]any{"id": artID}, mcpCtx)
	if getResp.Status != http.StatusOK {
		t.Fatalf("tool get-article = %d", getResp.Status)
	}
}

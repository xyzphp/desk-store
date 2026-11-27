package apphost_test

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/xyzphp/desk-store/pkg/appspec"
	"github.com/xyzphp/desk-store/sdk/apphost"
	"github.com/xyzphp/desk-store/sdk/appkit"
)

func TestHostRouterDatabaseKVAndIntegrations(t *testing.T) {
	migDir := t.TempDir()
	sharedDir := filepath.Join(migDir, "shared")
	acctDir := filepath.Join(migDir, "account")
	if err := os.MkdirAll(sharedDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(acctDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sharedDir, "0001_init.sql"),
		[]byte(`CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL);`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sharedDir, "0002_add-priority.sql"),
		[]byte(`ALTER TABLE items ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(acctDir, "0001_init.sql"),
		[]byte(`CREATE TABLE prefs (k TEXT PRIMARY KEY, v TEXT NOT NULL);`), 0o644); err != nil {
		t.Fatal(err)
	}

	manifest := &appspec.Manifest{
		Format:  2,
		Slug:    "sdk-demo",
		Version: "1.1.0",
		Platform: &appspec.Platform{
			Uses:     []string{"identity", "notify"},
			Provides: map[string]json.RawMessage{"settings": json.RawMessage(`{"fields":[]}`)},
		},
		Backend: &appspec.Backend{
			Runtime: "wasm",
			ABI:     1,
			Module:  "backend/app.wasm",
			Storage: &appspec.BackendStorage{Shared: true, Account: true},
			HTTP:    &appspec.BackendHTTP{Allow: []appspec.HTTPAllow{{Host: "api.example.com", Methods: []string{"GET"}}}},
			Config:  []appspec.ConfigItem{{Key: "webhook_secret", Title: "回调密钥", Secret: true}},
		},
	}

	host := apphost.New(
		apphost.WithManifest(manifest),
		apphost.WithConfig(map[string]string{"webhook_secret": "s3cr3t"}),
		apphost.WithSettings(map[string]any{"default_priority": "high"}),
		apphost.WithAuthorizedUsers(10, 20),
		apphost.WithHTTPHandler(func(req appkit.HTTPRequest) (appkit.HTTPResponse, error) {
			return appkit.HTTPResponse{Status: 200, Body: []byte(`{"remote":"ok"}`)}, nil
		}),
	)
	defer host.Close()

	if err := host.ApplyMigrationsFromDir(migDir); err != nil {
		t.Fatalf("ApplyMigrationsFromDir: %v", err)
	}

	// 验证已发布迁移被篡改时拒绝执行
	if err := os.WriteFile(filepath.Join(sharedDir, "0001_init.sql"),
		[]byte(`CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, extra TEXT);`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := host.ApplyMigrationsFromDir(migDir); err == nil || !strings.Contains(err.Error(), "校验和不一致") {
		t.Fatalf("expected checksum mismatch error, got %v", err)
	}

	// 测试 migrate 生命周期钩子
	if err := host.RunMigrate("1.0.0", "1.1.0", func(ev appkit.MigrateEvent) error {
		if ev.FromVersion != "1.0.0" || ev.ToVersion != "1.1.0" {
			t.Fatalf("unexpected migrate event: %+v", ev)
		}
		_, err := appkit.KV("shared").Set("migrated_to", ev.ToVersion)
		return err
	}); err != nil {
		t.Fatalf("RunMigrate: %v", err)
	}

	router := appkit.NewRouter()
	router.Post("/items", func(c *appkit.Context) {
		var body struct {
			Title string `json:"title"`
		}
		if err := c.BindJSON(&body); err != nil {
			c.Error(http.StatusBadRequest, err.Error())
			return
		}
		db := appkit.OpenDB("shared")
		tx, err := db.Begin()
		if err != nil {
			c.Error(http.StatusInternalServerError, err.Error())
			return
		}
		res, err := tx.Exec(`INSERT INTO items(title) VALUES(?)`, body.Title)
		if err != nil {
			_ = tx.Rollback()
			c.Error(http.StatusInternalServerError, err.Error())
			return
		}
		if err := tx.Commit(); err != nil {
			c.Error(http.StatusInternalServerError, err.Error())
			return
		}
		id, _ := res.LastInsertId()
		_ = appkit.NotifySend("新任务", body.Title, 20)
		appkit.LogInfo("created item %d", id)
		c.JSON(http.StatusCreated, map[string]any{"id": id})
	})
	router.Get("/items/:id", func(c *appkit.Context) {
		db := appkit.OpenDB("shared")
		var title, prio string
		if err := db.QueryRow(`SELECT title, priority FROM items WHERE id = ?`, c.Param("id")).Scan(&title, &prio); err != nil {
			c.Error(http.StatusNotFound, err.Error())
			return
		}
		secret, ok, _ := appkit.Config("webhook_secret")
		var settings map[string]string
		_, _ = appkit.SettingsGet(&settings)
		remote, _ := appkit.HTTPFetch(appkit.HTTPRequest{Method: "GET", URL: "https://api.example.com/ping"})
		c.JSON(http.StatusOK, map[string]any{
			"title":      title,
			"priority":   prio,
			"has_secret": ok && secret == "s3cr3t",
			"setting":    settings["default_priority"],
			"remote":     string(remote.Body),
		})
	})

	createPayload, _ := json.Marshal(map[string]string{"title": "编写文档"})
	resp, err := host.Do(appkit.RequestEnvelope{
		Method:  http.MethodPost,
		Path:    "/items",
		BodyB64: base64.StdEncoding.EncodeToString(createPayload),
		Context: appkit.RequestContext{User: &appkit.User{ID: 10, DisplayName: "Alice"}},
	}, router)
	if err != nil || resp.Status != http.StatusCreated {
		t.Fatalf("POST /items: status=%d err=%v", resp.Status, err)
	}

	getResp, err := host.Do(appkit.RequestEnvelope{
		Method:  http.MethodGet,
		Path:    "/items/1",
		Context: appkit.RequestContext{User: &appkit.User{ID: 10, DisplayName: "Alice"}},
	}, router)
	if err != nil || getResp.Status != http.StatusOK {
		t.Fatalf("GET /items/1: status=%d err=%v", getResp.Status, err)
	}
	rawBody, _ := base64.StdEncoding.DecodeString(getResp.BodyB64)
	var got map[string]any
	if err := json.Unmarshal(rawBody, &got); err != nil {
		t.Fatal(err)
	}
	if got["title"] != "编写文档" || got["priority"] != "normal" || got["has_secret"] != true || got["setting"] != "high" {
		t.Fatalf("unexpected response body: %+v", got)
	}
	if len(host.Notifications()) != 1 || host.Notifications()[0].UserID != 20 {
		t.Fatalf("unexpected notifications: %+v", host.Notifications())
	}
	if len(host.Logs()) != 1 {
		t.Fatalf("unexpected logs: %+v", host.Logs())
	}
}

func TestHostReferencedFilesAndAIComplete(t *testing.T) {
	manifest := &appspec.Manifest{
		Format: 2, Slug: "ref-demo", Version: "1.0.0",
		Platform: &appspec.Platform{Uses: []string{"files.reference", "ai.complete"}},
		Backend:  &appspec.Backend{Runtime: "wasm", ABI: 1, Module: "backend/app.wasm"},
	}
	host := apphost.New(
		apphost.WithManifest(manifest),
		apphost.WithReferencedFiles(map[string]apphost.ReferencedFile{"file:7": {Name: "cover.png", MediaType: "image/png", Data: []byte("png")}}),
	)
	defer host.Close()
	var file appkit.ReferencedFile
	var completion appkit.AICompletion
	var missingErr, imageErr error
	handler := appkit.HandlerFunc(func(c *appkit.Context) {
		var err error
		if file, err = appkit.FileReferenceRead("file:7", false); err != nil {
			c.Error(http.StatusInternalServerError, err.Error())
			return
		}
		_, missingErr = appkit.FileReferenceRead("file:8", true)
		if completion, err = appkit.AIComplete([]appkit.AIMessage{{Role: "user", Content: "你好"}}, appkit.AICompleteOptions{}); err != nil {
			c.Error(http.StatusInternalServerError, err.Error())
			return
		}
		imageErr = appkit.PlatformCall("ai.image", map[string]any{"prompt": "x"}, nil)
		c.SendUserFile(http.StatusOK, "file:7", true)
	})
	resp, err := host.Do(appkit.RequestEnvelope{Method: http.MethodGet, Path: "/x", Context: appkit.RequestContext{User: &appkit.User{ID: 1}}}, handler)
	if err != nil || resp.Status != http.StatusOK || resp.SendFile != "file:7" || resp.Headers["content-disposition"] != "inline" {
		t.Fatalf("unexpected response: %+v err=%v", resp, err)
	}
	if data, _ := base64.StdEncoding.DecodeString(file.DataB64); string(data) != "png" || file.Name != "cover.png" {
		t.Fatalf("referenced file: %+v", file)
	}
	if !appkit.IsCode(missingErr, appkit.CodeNotFound) || !appkit.IsCode(imageErr, appkit.CodeDenied) {
		t.Fatalf("missing=%v image=%v", missingErr, imageErr)
	}
	if !strings.Contains(completion.Text, "你好") {
		t.Fatalf("completion: %+v", completion)
	}
}

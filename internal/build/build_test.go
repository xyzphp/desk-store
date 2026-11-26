package build

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/xyzphp/desk-store/pkg/appspec"
)

const testManifest = `{"format":2,"slug":"notes","name":"笔记","version":"%s","description":"","entry":"index.html","icon":"icon.svg",
"backend":{"runtime":"wasm","abi":1,"module":"backend/app.wasm","routes":[{"path":"/notes","methods":["GET"],"visibility":"app"}],
"storage":{"shared":true}}}`

func writeFile(t *testing.T, file, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// writeNotesApp 写出一个格式 2 应用；migrations 为 shared 范围的迁移文件名与内容。
func writeNotesApp(t *testing.T, root, version string, migrations map[string]string) {
	t.Helper()
	dir := filepath.Join(root, "apps", "notes")
	if err := os.RemoveAll(dir); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(dir, "store.json"), `{"summary":"笔记","category":"tools","authors":[{"name":"示例"}],"license":"MIT"}`)
	writeFile(t, filepath.Join(dir, "package", "manifest.json"), strings.Replace(testManifest, "%s", version, 1))
	writeFile(t, filepath.Join(dir, "package", "index.html"), "<!doctype html>")
	writeFile(t, filepath.Join(dir, "package", "icon.svg"), "<svg/>")
	writeFile(t, filepath.Join(dir, "build.json"), `{"backend":{"toolchain":"go@1.26","abi":1}}`)
	writeFile(t, filepath.Join(dir, "backend", "go.mod"), "module example.com/notes-backend\n\ngo 1.26.10\n")
	writeFile(t, filepath.Join(dir, "backend", "main.go"), "package main\n\nfunc main() {}\n")
	for name, sql := range migrations {
		writeFile(t, filepath.Join(dir, "package", "backend", "migrations", "shared", name), sql)
	}
}

func TestBuildPublishesMigrationsAndRejectsRewrites(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "store.config.json"), `{"id":"test-store","name":"测试商店","access":"public","keys":[]}`)
	options := func(out, previous string) Options {
		return Options{AppsDir: filepath.Join(root, "apps"), ConfigPath: filepath.Join(root, "store.config.json"), OutDir: out,
			Previous: previous, Now: time.Date(2026, 11, 26, 0, 0, 0, 0, time.UTC)}
	}
	first := filepath.Join(root, "out1")
	writeNotesApp(t, root, "1.0.0", map[string]string{"0001_init.sql": "CREATE TABLE notes (id INTEGER PRIMARY KEY);"})
	if _, err := Run(options(first, "")); err != nil {
		t.Fatalf("first build: %v", err)
	}
	var detail appspec.AppDetail
	raw, err := os.ReadFile(filepath.Join(APIDir(first), "apps", "notes.json"))
	if err != nil || json.Unmarshal(raw, &detail) != nil {
		t.Fatalf("read detail: %v", err)
	}
	version := detail.Versions[0]
	if len(version.Migrations["shared"]) != 1 || strings.Join(version.Components, ",") != "ui,backend" ||
		version.Requires == nil || version.Requires.Platform != 1 || len(version.Capabilities) == 0 {
		t.Fatalf("published version: %+v", version)
	}
	var index appspec.Index
	raw, _ = os.ReadFile(filepath.Join(APIDir(first), "index.json"))
	if json.Unmarshal(raw, &index) != nil || strings.Join(index.Apps[0].Components, ",") != "ui,backend" {
		t.Fatalf("index entry: %+v", index.Apps)
	}

	// 修改已发布的迁移：即使提升版本也必须失败。
	writeNotesApp(t, root, "1.1.0", map[string]string{"0001_init.sql": "CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT);"})
	if _, err := Run(options(filepath.Join(root, "out2"), APIDir(first))); err == nil || !strings.Contains(err.Error(), "0001_init") {
		t.Fatalf("rewriting a published migration must fail, got %v", err)
	}

	// 只追加新迁移：允许发布。
	writeNotesApp(t, root, "1.1.0", map[string]string{
		"0001_init.sql":     "CREATE TABLE notes (id INTEGER PRIMARY KEY);",
		"0002_add-body.sql": "ALTER TABLE notes ADD COLUMN body TEXT NOT NULL DEFAULT '';",
	})
	result, err := Run(options(filepath.Join(root, "out3"), APIDir(first)))
	if err != nil || len(result.NewVersions) != 1 || result.NewVersions[0].Version != "1.1.0" {
		t.Fatalf("appending a migration: %+v %v", result, err)
	}
}

func TestBuildSignsAdvisories(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "store.config.json"), `{"id":"test-store","name":"测试商店","access":"public","keys":[]}`)
	writeNotesApp(t, root, "1.0.0", nil)
	writeFile(t, filepath.Join(root, "advisories", "DS-2026-0001.json"),
		`{"id":"DS-2026-0001","slug":"notes","versions":"<1.0.1","severity":"high","title":"示例问题","description":"","fixedIn":"1.0.1","action":"update"}`)
	out := filepath.Join(root, "out")
	if _, err := Run(Options{AppsDir: filepath.Join(root, "apps"), ConfigPath: filepath.Join(root, "store.config.json"),
		AdvisoriesDir: filepath.Join(root, "advisories"), OutDir: out}); err != nil {
		t.Fatalf("build: %v", err)
	}
	if err := VerifyOutput(out); err == nil {
		t.Fatal("unsigned output must fail verification")
	}
	seed := make([]byte, 32)
	if _, err := Sign(SignOptions{OutDir: out, PrivateKey: base64.StdEncoding.EncodeToString(seed)}); err != nil {
		t.Fatalf("sign: %v", err)
	}
	if err := VerifyOutput(out); err != nil {
		t.Fatalf("verify: %v", err)
	}
	var info appspec.StoreInfo
	raw, _ := os.ReadFile(filepath.Join(APIDir(out), "store.json"))
	if json.Unmarshal(raw, &info) != nil || info.Advisories != appspec.AdvisoriesFile || len(info.Formats) != 2 {
		t.Fatalf("store.json: %+v", info)
	}
	if err := os.WriteFile(filepath.Join(APIDir(out), appspec.AdvisoriesFile), []byte(`{"schema":1,"advisories":[]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := VerifyOutput(out); err == nil {
		t.Fatal("tampered advisories must fail verification")
	}
}

func TestLoadAppRejectsPrebuiltModuleAndMissingBuildSpec(t *testing.T) {
	root := t.TempDir()
	writeNotesApp(t, root, "1.0.0", nil)
	dir := filepath.Join(root, "apps", "notes")
	writeFile(t, filepath.Join(dir, "package", "backend", "app.wasm"), "\x00asm")
	if _, err := LoadApp(dir); err == nil || !strings.Contains(err.Error(), "预编译") {
		t.Fatalf("a committed module must be rejected, got %v", err)
	}
	if err := os.Remove(filepath.Join(dir, "package", "backend", "app.wasm")); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(dir, "build.json")); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadApp(dir); err == nil || !strings.Contains(err.Error(), "build.json") {
		t.Fatalf("backend sources without build.json must be rejected, got %v", err)
	}
}

func TestBuildIsReproducible(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "store.config.json"), `{"id":"test-store","name":"测试商店","access":"public","keys":[]}`)
	writeNotesApp(t, root, "1.0.0", map[string]string{"0001_init.sql": "CREATE TABLE notes (id INTEGER PRIMARY KEY);"})
	digests := []string{}
	for _, name := range []string{"a", "b"} {
		out := filepath.Join(root, name)
		if _, err := Run(Options{AppsDir: filepath.Join(root, "apps"), ConfigPath: filepath.Join(root, "store.config.json"), OutDir: out}); err != nil {
			t.Fatalf("build %s: %v", name, err)
		}
		data, err := os.ReadFile(filepath.Join(APIDir(out), "packages", "notes-1.0.0.zip"))
		if err != nil {
			t.Fatal(err)
		}
		digests = append(digests, appspec.SHA256(data))
	}
	if digests[0] != digests[1] {
		t.Fatalf("two builds produced different packages: %v", digests)
	}
}

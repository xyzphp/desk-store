package appspec

import (
	"crypto/ed25519"
	"crypto/rand"
	"strings"
	"testing"
)

// mixedManifest 是一个包含界面、后端、声明式与后端工具、技能、访问控制与公开入口的格式 2 清单。
const mixedManifest = `{
  "format": 2, "slug": "mixed-demo", "name": "混合示例", "version": "1.0.0", "description": "",
  "entry": "index.html", "icon": "icon.svg",
  "permissions": ["proxy.weather"],
  "proxies": [{"key": "weather", "title": "天气", "upstream": "https://api.example.com", "auth_type": "none",
    "paths": ["/now"], "methods": ["GET"], "pass_query": true}],
  "requires": {"platform": 1},
  "access": {"permissions": [{"name": "note.write", "title": "写笔记"}], "default_grant": "all_accounts"},
  "surfaces": {"home": "/", "window": {"pages": [{"path": "/admin/", "visibility": "permission:note.write"}]},
    "standalone": {"enabled": true},
    "public": {"pages": [{"path": "/", "visibility": "public"}], "alias": "/notes", "session": "optional"}},
  "platform": {"uses": ["identity", "notify"], "provides": {"settings": {"fields": []}, "account_deleted": {"route": "/hooks/account-deleted"},
    "builtin_import": {"sources": ["articles.site"], "route": "/tools/import"}}},
  "backend": {"runtime": "wasm", "abi": 1, "module": "backend/app.wasm",
    "routes": [{"path": "/notes", "methods": ["GET", "POST"], "visibility": "app", "token_scope": "notes"},
      {"path": "/public/*", "methods": ["GET"], "visibility": "public", "rate_limit": "60/min"},
      {"path": "/tools/*", "methods": ["POST"], "visibility": "app"},
      {"path": "/hooks/account-deleted", "methods": ["POST"], "visibility": "app"},
      {"path": "/jobs/digest", "methods": ["POST"], "visibility": "app"}],
    "storage": {"shared": true, "public": true},
    "http": {"allow": [{"host": "api.example.com", "methods": ["GET"]}]},
    "schedules": [{"name": "digest", "cron": "0 9 * * *", "route": "/jobs/digest"}],
    "config": [{"key": "api_secret", "title": "接口密钥", "secret": true}],
    "token_scopes": [{"id": "notes", "label": "读写笔记", "description": "读取与新增本人的笔记"}]},
  "mcp": {"tools": [
      {"name": "get_weather", "title": "查天气", "description": "按城市查询天气",
       "input_schema": {"type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]},
       "annotations": {"read_only": true},
       "call": {"proxy": "weather", "method": "GET", "path": "/now", "query": {"city": "{city}"}}},
      {"name": "add_note", "title": "新增笔记", "description": "新增一条笔记",
       "input_schema": {"type": "object", "properties": {"text": {"type": "string", "maxLength": 2000}}},
       "annotations": {"destructive": true}, "call": {"backend": "/tools/add-note"}}],
    "prompts": [{"name": "summary", "title": "总结笔记", "file": "mcp/prompts/summary.md"}]},
  "skills": ["note-taking"]
}`

func mixedFiles() []File {
	return []File{
		{Path: "index.html", Content: []byte("<!doctype html>")},
		{Path: "icon.svg", Content: []byte("<svg/>")},
		{Path: "backend/app.wasm", Content: []byte("\x00asm\x01\x00\x00\x00")},
		{Path: "backend/migrations/shared/0001_init.sql", Content: []byte("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL);")},
		{Path: "backend/migrations/shared/0002_add-title.sql", Content: []byte("ALTER TABLE notes ADD COLUMN title TEXT NOT NULL DEFAULT '';")},
		{Path: "backend/migrations/public/0001_init.sql", Content: []byte("CREATE TABLE published (id INTEGER PRIMARY KEY);")},
		{Path: "mcp/prompts/summary.md", Content: []byte("请总结以下笔记。")},
		{Path: "skills/note-taking/SKILL.md", Content: []byte("---\nname: note-taking\ndescription: 记笔记的写法\ntools: [add_note]\n---\n先写标题。")},
		{Path: "skills/note-taking/references/style.md", Content: []byte("# 风格")},
	}
}

func TestFormatTwoAcceptsMixedApp(t *testing.T) {
	manifest, err := ParseManifest([]byte(mixedManifest), mixedFiles())
	if err != nil {
		t.Fatalf("ParseManifest() error = %v", err)
	}
	if !manifest.HasUI() || manifest.RequiredPlatform() != 1 {
		t.Fatalf("unexpected manifest: %+v", manifest)
	}
	if skills := manifest.SkillInfos(); len(skills) != 1 || skills[0].Description != "记笔记的写法" || skills[0].Tools[0] != "add_note" {
		t.Fatalf("skills: %+v", skills)
	} else if len(skills[0].Files) != 2 || skills[0].Files[0].Path != "SKILL.md" || skills[0].Files[1].Path != "references/style.md" || skills[0].Files[1].Content != "# 风格" {
		t.Fatalf("skill files: %+v", skills[0].Files)
	}
	if scopes := manifest.Backend.StorageScopes(); strings.Join(scopes, ",") != "shared,public" {
		t.Fatalf("storage scopes: %v", scopes)
	}
}

func TestFormatOneRejectsFormatTwoFields(t *testing.T) {
	raw := strings.Replace(minimalManifest, `"icon":"icon.svg"`, `"icon":"icon.svg","skills":["x"]`, 1)
	_, err := ParseManifest([]byte(raw), minimalFiles())
	if err == nil || !strings.Contains(err.Error(), "skills") {
		t.Fatalf("expected a format error naming skills, got %v", err)
	}
}

func TestFormatTwoRejectsInvalidDeclarations(t *testing.T) {
	cases := map[string][2]string{
		"undeclared permission":   {`"visibility": "permission:note.write"`, `"visibility": "permission:note.read"`},
		"public in window":        {`{"path": "/admin/", "visibility": "permission:note.write"}`, `{"path": "/admin/", "visibility": "public"}`},
		"reserved alias":          {`"alias": "/notes"`, `"alias": "/api/notes"`},
		"unknown capability":      {`"uses": ["identity", "notify"]`, `"uses": ["identity", "root"]`},
		"code extension no route": {`"route": "/hooks/account-deleted"`, `"route": "/hooks/missing"`},
		"bad runtime":             {`"runtime": "wasm"`, `"runtime": "native"`},
		"duplicate route":         {`{"path": "/notes", "methods": ["GET", "POST"]`, `{"path": "/notes", "methods": ["GET", "GET"]`},
		"http with scheme":        {`"host": "api.example.com"`, `"host": "https://api.example.com"`},
		"cron too frequent":       {`"cron": "0 9 * * *"`, `"cron": "*/2 * * * *"`},
		"cron range every minute": {`"cron": "0 9 * * *"`, `"cron": "0-10 9 * * *"`},
		"placeholder unknown":     {`"query": {"city": "{city}"}`, `"query": {"city": "{town}"}`},
		"proxy path outside":      {`"path": "/now", "query"`, `"path": "/forecast", "query"`},
		"backend tool no route":   {`"call": {"backend": "/tools/add-note"}`, `"call": {"backend": "/other"}`},
		"schema keyword":          {`"maxLength": 2000`, `"pattern": ".*"`},
		"read only and destructive": {`"annotations": {"destructive": true}`,
			`"annotations": {"destructive": true, "read_only": true}`},
		"skill not declared":     {`"skills": ["note-taking"]`, `"skills": ["other-skill"]`},
		"import unknown source":  {`"sources": ["articles.site"]`, `"sources": ["bookmarks"]`},
		"import public route":    {`"route": "/tools/import"`, `"route": "/public/import"`},
		"import missing route":   {`"route": "/tools/import"`, `"route": "/missing"`},
		"import extra field":     {`"sources": ["articles.site"], "route"`, `"sources": ["articles.site"], "x": 1, "route"`},
		"token scope undeclared": {`"token_scope": "notes"`, `"token_scope": "other"`},
		"token scope unused":     {`{"id": "notes", "label"`, `{"id": "notes", "label": "x"}, {"id": "spare", "label"`},
		"token scope bad id":     {`{"id": "notes", "label"`, `{"id": "Notes!", "label"`},
		"token scope on public": {`"visibility": "public", "rate_limit": "60/min"}`,
			`"visibility": "public", "rate_limit": "60/min", "token_scope": "notes"}`},
	}
	for name, change := range cases {
		raw := strings.Replace(mixedManifest, change[0], change[1], 1)
		if raw == mixedManifest {
			t.Fatalf("%s: replacement did not apply", name)
		}
		if _, err := ParseManifest([]byte(raw), mixedFiles()); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

func TestFormatTwoFilePlacementAndSkills(t *testing.T) {
	cases := map[string]func([]File) []File{
		"wasm elsewhere": func(files []File) []File {
			return append(files, File{Path: "other.wasm", Content: []byte("x")})
		},
		"script in skills": func(files []File) []File {
			return append(files, File{Path: "skills/note-taking/references/run.js", Content: []byte("x")})
		},
		"skill name mismatch": func(files []File) []File {
			files[7] = File{Path: "skills/note-taking/SKILL.md", Content: []byte("---\nname: other\ndescription: x\n---\n")}
			return files
		},
		"skill references unknown tool": func(files []File) []File {
			files[7] = File{Path: "skills/note-taking/SKILL.md", Content: []byte("---\nname: note-taking\ndescription: x\ntools:\n  - missing\n---\n")}
			return files
		},
		"missing module": func(files []File) []File {
			return append(files[:2], files[3:]...)
		},
	}
	for name, mutate := range cases {
		if _, err := ParseManifest([]byte(mixedManifest), mutate(mixedFiles())); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

func TestMigrationRules(t *testing.T) {
	cases := map[string]File{
		"skipped number":  {Path: "backend/migrations/shared/0004_late.sql", Content: []byte("CREATE TABLE x (id INTEGER);")},
		"bad name":        {Path: "backend/migrations/shared/3_bad.sql", Content: []byte("CREATE TABLE x (id INTEGER);")},
		"disabled scope":  {Path: "backend/migrations/account/0001_init.sql", Content: []byte("CREATE TABLE x (id INTEGER);")},
		"attach":          {Path: "backend/migrations/shared/0003_attach.sql", Content: []byte("ATTACH DATABASE 'x.db' AS other;")},
		"transaction":     {Path: "backend/migrations/shared/0003_tx.sql", Content: []byte("BEGIN; CREATE TABLE x (id INTEGER); COMMIT;")},
		"pragma":          {Path: "backend/migrations/shared/0003_pragma.sql", Content: []byte("PRAGMA journal_mode = OFF;")},
		"system table":    {Path: "backend/migrations/shared/0003_ledger.sql", Content: []byte("DELETE FROM _app_migrations;")},
		"vacuum into":     {Path: "backend/migrations/shared/0003_vacuum.sql", Content: []byte("VACUUM INTO '/tmp/x.db';")},
		"unclosed string": {Path: "backend/migrations/shared/0003_bad.sql", Content: []byte("INSERT INTO notes (body) VALUES ('x);")},
	}
	for name, extra := range cases {
		files := append(mixedFiles(), extra)
		if _, err := ParseManifest([]byte(mixedManifest), files); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
	trigger := File{Path: "backend/migrations/shared/0003_trigger.sql", Content: []byte(`-- 记录修改时间；字符串里的 ; 不拆分
CREATE TRIGGER notes_touch AFTER UPDATE ON notes BEGIN
  UPDATE notes SET title = CASE WHEN new.title = '' THEN 'a;b' ELSE new.title END WHERE id = new.id;
END;
PRAGMA foreign_keys = ON;`)}
	if _, err := ParseManifest([]byte(mixedManifest), append(mixedFiles(), trigger)); err != nil {
		t.Fatalf("trigger migration: %v", err)
	}
	statements, err := splitSQL(string(trigger.Content))
	if err != nil || len(statements) != 2 {
		t.Fatalf("splitSQL() = %q, %v", statements, err)
	}
}

func TestCompareMigrations(t *testing.T) {
	previous := map[string][]MigrationDigest{"shared": {{ID: "0001_init", SHA256: "a"}, {ID: "0002_more", SHA256: "b"}}}
	appended := map[string][]MigrationDigest{"shared": {{ID: "0001_init", SHA256: "a"}, {ID: "0002_more", SHA256: "b"}, {ID: "0003_new", SHA256: "c"}}}
	if err := CompareMigrations(previous, appended); err != nil {
		t.Fatalf("appending must be allowed: %v", err)
	}
	broken := map[string]map[string][]MigrationDigest{
		"modified": {"shared": {{ID: "0001_init", SHA256: "x"}, {ID: "0002_more", SHA256: "b"}}},
		"removed":  {"shared": {{ID: "0001_init", SHA256: "a"}}},
		"renamed":  {"shared": {{ID: "0001_init", SHA256: "a"}, {ID: "0002_other", SHA256: "b"}}},
		"scope":    {},
	}
	for name, current := range broken {
		if err := CompareMigrations(previous, current); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
	digests := MigrationDigests(mixedFiles())
	if len(digests["shared"]) != 2 || digests["shared"][1].ID != "0002_add-title" || len(digests["public"]) != 1 {
		t.Fatalf("MigrationDigests() = %+v", digests)
	}
}

func TestMinuteInterval(t *testing.T) {
	for field, want := range map[string]bool{
		"0": true, "*/5": true, "*/4": false, "0,30": true, "0,3": false, "58,1": false, "0-30/10": true, "5-6": false, "*": false, "61": false,
	} {
		if got := minuteIntervalAtLeast(field, 5); got != want {
			t.Errorf("minuteIntervalAtLeast(%q) = %v, want %v", field, got, want)
		}
	}
}

func TestFormatTwoLimits(t *testing.T) {
	big := make([]byte, 3<<20)
	files := append(mixedFiles(), File{Path: "assets/big.js", Content: big})
	if _, err := ParseManifest([]byte(mixedManifest), files); err == nil {
		t.Fatal("a 3 MB asset must exceed the single-file limit")
	}
	if err := checkFormatLimits(1, 10, []File{{Path: "skills/x/SKILL.md", Content: []byte("x")}}); err == nil {
		t.Fatal("format 1 must reject .md files")
	}
}

func TestFormatTwoComponentsAndCapabilities(t *testing.T) {
	manifest, err := ParseManifest([]byte(mixedManifest), mixedFiles())
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(manifest.Components(), ","); got != "ui,backend,mcp,skills" {
		t.Fatalf("Components() = %s", got)
	}
	marks := strings.Join(manifest.Capabilities(), ",")
	for _, want := range []string{
		"format.2", "platform.1", "backend.wasm.abi1", "storage.shared", "storage.public", "access.permissions",
		"access.default_grant", "surface.standalone", "surface.public", "surface.public.session", "uses.notify",
		"provides.account_deleted", "backend.token_scopes", "mcp.tools", "mcp.declarative", "mcp.prompts", "skills",
	} {
		if !strings.Contains(","+marks+",", ","+want+",") {
			t.Errorf("Capabilities() lacks %s: %s", want, marks)
		}
	}
	plain, err := ParseManifest([]byte(minimalManifest), minimalFiles())
	if err != nil {
		t.Fatal(err)
	}
	summary := plain.Summarize()
	if summary.Access != nil || summary.Backend != nil || summary.MCP != nil || summary.Skills != nil || len(plain.Capabilities()) != 0 {
		t.Fatalf("format 1 summaries must not change: %+v", summary)
	}
}

func TestFormatTwoSummaryAndDiff(t *testing.T) {
	manifest, err := ParseManifest([]byte(mixedManifest), mixedFiles())
	if err != nil {
		t.Fatal(err)
	}
	summary := manifest.Summarize()
	if summary.Backend == nil || len(summary.Backend.Routes) != 5 || summary.MCP == nil || len(summary.MCP.Tools) != 2 {
		t.Fatalf("summary: %+v", summary)
	}
	if tool := summary.MCP.Tools[1]; tool.Kind != "backend" || !tool.Destructive {
		t.Fatalf("tool summary: %+v", tool)
	}
	markdown := summary.Markdown()
	for _, want := range []string{"公开页面（未登录可访问）", "有副作用", "技能 `note-taking`", "接口密钥（加密保存）"} {
		if !strings.Contains(markdown, want) {
			t.Errorf("Markdown() lacks %q:\n%s", want, markdown)
		}
	}
	previous := summary
	previous.Backend = &BackendSummary{Routes: summary.Backend.Routes[:1], Storage: StorageSummary{Shared: true}}
	previous.MCP = &MCPSummary{Tools: summary.MCP.Tools[:1]}
	previous.Surfaces = &SurfacesSummary{Standalone: true}
	previous.Skills = nil
	changes := strings.Join(Diff(previous, summary), "\n")
	for _, want := range []string{"新增后端路由 GET /public/*（public）", "启用存储范围 public", "新增可访问的外部主机 api.example.com",
		"新增 AI 工具 add_note（backend，有副作用）", "新增公开页面", "新增技能 note-taking"} {
		if !strings.Contains(changes, want) {
			t.Errorf("Diff() lacks %q:\n%s", want, changes)
		}
	}
}

func TestAdvisories(t *testing.T) {
	advisory := Advisory{ID: "DS-2026-0001", Slug: "notes", Versions: ">=1.0.0 <1.2.3", Severity: "high", Title: "问题", FixedIn: "1.2.3", Action: "update"}
	if err := advisory.Validate(); err != nil {
		t.Fatalf("Validate() error = %v", err)
	}
	for version, want := range map[string]bool{"0.9.0": false, "1.0.0": true, "1.2.2": true, "1.2.3": false} {
		if advisory.Affects(version) != want {
			t.Errorf("Affects(%s) != %v", version, want)
		}
	}
	invalid := []Advisory{
		{ID: "bad", Slug: "notes", Versions: "<1.0.0", Severity: "low", Title: "x", Action: "disable"},
		{ID: "DS-2026-0002", Slug: "notes", Versions: "~1.0.0", Severity: "low", Title: "x", Action: "disable"},
		{ID: "DS-2026-0003", Slug: "notes", Versions: "<2.0.0", Severity: "low", Title: "x", FixedIn: "1.5.0", Action: "update"},
		{ID: "DS-2026-0004", Slug: "notes", Versions: "<2.0.0", Severity: "urgent", Title: "x", Action: "disable"},
	}
	for _, item := range invalid {
		if item.Validate() == nil {
			t.Errorf("%s: expected an error", item.ID)
		}
	}
	public, private, _ := ed25519.GenerateKey(rand.Reader)
	keys := []PublicKey{NewPublicKey(public)}
	data := []byte(`{"schema":1,"advisories":[]}`)
	signature := SignAdvisories(private, data)
	if err := VerifyAdvisories(keys, data, signature); err != nil {
		t.Fatalf("VerifyAdvisories() error = %v", err)
	}
	if VerifyAdvisories(keys, append(data, ' '), signature) == nil {
		t.Fatal("a modified advisories file must fail verification")
	}
}

func TestFormatTwoRouteAudit(t *testing.T) {
	raw := strings.Replace(
		mixedManifest,
		`{"path": "/notes", "methods": ["GET", "POST"], "visibility": "app", "token_scope": "notes"}`,
		`{"path": "/notes", "methods": ["GET", "POST"], "visibility": "app", "token_scope": "notes", "audit": {"mode": "all", "action": "manage_notes", "label": "  操作笔记  "}}`,
		1,
	)
	raw = strings.Replace(
		raw,
		`{"path": "/jobs/digest", "methods": ["POST"], "visibility": "app"}`,
		`{"path": "/jobs/digest", "methods": ["POST"], "visibility": "app", "audit": {"mode": "off"}}`,
		1,
	)
	manifest, err := ParseManifest([]byte(raw), mixedFiles())
	if err != nil {
		t.Fatalf("ParseManifest() with valid route audit failed: %v", err)
	}
	summary := manifest.Summarize()
	if summary.Backend == nil || len(summary.Backend.Routes) < 5 {
		t.Fatalf("unexpected backend summary: %+v", summary.Backend)
	}
	gotNotes := summary.Backend.Routes[0].Audit
	if gotNotes == nil || gotNotes.Mode != "all" || gotNotes.Action != "manage_notes" || gotNotes.Label != "操作笔记" {
		t.Fatalf("notes route audit summary = %+v", gotNotes)
	}
	gotJob := summary.Backend.Routes[4].Audit
	if gotJob == nil || gotJob.Mode != "off" || gotJob.Action != "" || gotJob.Label != "" {
		t.Fatalf("job route audit summary = %+v", gotJob)
	}

	invalidCases := map[string][2]string{
		"unknown audit mode": {
			`{"path": "/tools/*", "methods": ["POST"], "visibility": "app"}`,
			`{"path": "/tools/*", "methods": ["POST"], "visibility": "app", "audit": {"mode": "debug"}}`,
		},
		"off with label": {
			`{"path": "/tools/*", "methods": ["POST"], "visibility": "app"}`,
			`{"path": "/tools/*", "methods": ["POST"], "visibility": "app", "audit": {"mode": "off", "label": "不应存在"}}`,
		},
		"off with action": {
			`{"path": "/tools/*", "methods": ["POST"], "visibility": "app"}`,
			`{"path": "/tools/*", "methods": ["POST"], "visibility": "app", "audit": {"mode": "off", "action": "tool_run"}}`,
		},
		"all on public route": {
			`{"path": "/public/*", "methods": ["GET"], "visibility": "public", "rate_limit": "60/min"}`,
			`{"path": "/public/*", "methods": ["GET"], "visibility": "public", "rate_limit": "60/min", "audit": {"mode": "all"}}`,
		},
		"invalid audit action": {
			`{"path": "/tools/*", "methods": ["POST"], "visibility": "app"}`,
			`{"path": "/tools/*", "methods": ["POST"], "visibility": "app", "audit": {"action": "Bad-Action"}}`,
		},
		"control char in audit label": {
			`{"path": "/tools/*", "methods": ["POST"], "visibility": "app"}`,
			`{"path": "/tools/*", "methods": ["POST"], "visibility": "app", "audit": {"label": "含换行\n标签"}}`,
		},
		"too long audit label": {
			`{"path": "/tools/*", "methods": ["POST"], "visibility": "app"}`,
			`{"path": "/tools/*", "methods": ["POST"], "visibility": "app", "audit": {"label": "` + strings.Repeat("字", 49) + `"}}`,
		},
	}
	for name, change := range invalidCases {
		bad := strings.Replace(mixedManifest, change[0], change[1], 1)
		if bad == mixedManifest {
			t.Fatalf("%s: replacement did not apply", name)
		}
		if _, err := ParseManifest([]byte(bad), mixedFiles()); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}
}

// Package apphost 提供应用包格式 2 后端模块（ABI 1）的本地测试运行器：
// 在开发机上模拟目标系统的清单能力门控、数据库迁移与 _app_migrations 一致性校验、
// shared / public / account 三类隔离存储、KV、安装配置、日志、外部 HTTP / 代理 / 系统接口与平台能力，
// 让后端模块可以直接使用 `go test` 完成测试。
package apphost

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/xyzphp/desk-store/pkg/appspec"
	"github.com/xyzphp/desk-store/sdk/appkit"
)

// LogEntry 记录模块通过 host.log 写出的日志。
type LogEntry struct {
	Level   uint32
	Message string
}

// Notification 记录模块通过 host.platform_call("notify.send") 发出的站内通知。
type Notification struct {
	UserID int64
	Title  string
	Body   string
}

type appliedMigration struct {
	ID         string
	SHA256     string
	AppVersion string
}

// Host 模拟目标系统的 ABI 1 宿主环境，实现 appkit.HostAdapter。
type Host struct {
	mu           sync.Mutex
	manifest     *appspec.Manifest
	config       map[string]string
	settings     map[string]any
	dataDir      string
	sqlOpener    func(scope string, userID int64) (*sql.DB, error)
	httpHandler  func(req appkit.HTTPRequest) (appkit.HTTPResponse, error)
	proxyHandler func(req appkit.ProxyRequest) (appkit.HTTPResponse, error)
	apiHandler   func(req appkit.APIRequest) (appkit.HTTPResponse, error)

	dbs          map[string]*memDB
	sqlDBs       map[string]*sql.DB
	migrations   map[string][]appliedMigration
	accountMigs  []migrationFile
	kv           map[string]map[string]kvEntry
	logs         []LogEntry
	notices      []Notification
	authorizedID map[int64]bool

	// 单次请求状态
	curReq   appkit.RequestEnvelope
	curReqJS []byte
	curResp  []byte
	txSeq    int
	memTxs   map[string]*memTx
	sqlTxs   map[string]*sqlTx
}

type kvEntry struct {
	value     json.RawMessage
	updatedAt int64
}

type memTx struct {
	dbKey    string
	scope    string
	readOnly bool
	snapshot *memDB
}

type sqlTx struct {
	tx       *sql.Tx
	scope    string
	readOnly bool
}

type migrationFile struct {
	ID     string
	Scope  string
	Path   string
	SHA256 string
	SQL    string
}

// Option 配置本地运行器。
type Option func(*Host)

func WithManifest(m *appspec.Manifest) Option {
	return func(h *Host) { h.manifest = m }
}

func WithConfig(cfg map[string]string) Option {
	return func(h *Host) {
		for k, v := range cfg {
			h.config[k] = v
		}
	}
}

func WithSettings(values map[string]any) Option {
	return func(h *Host) {
		for k, v := range values {
			h.settings[k] = v
		}
	}
}

func WithDataDir(dir string) Option {
	return func(h *Host) { h.dataDir = dir }
}

func WithAuthorizedUsers(ids ...int64) Option {
	return func(h *Host) {
		for _, id := range ids {
			h.authorizedID[id] = true
		}
	}
}

// WithSQLOpener 允许在本地测试中注入真实 *sql.DB（例如 modernc.org/sqlite）。
func WithSQLOpener(fn func(scope string, userID int64) (*sql.DB, error)) Option {
	return func(h *Host) { h.sqlOpener = fn }
}

func WithHTTPHandler(fn func(appkit.HTTPRequest) (appkit.HTTPResponse, error)) Option {
	return func(h *Host) { h.httpHandler = fn }
}

func WithProxyHandler(fn func(appkit.ProxyRequest) (appkit.HTTPResponse, error)) Option {
	return func(h *Host) { h.proxyHandler = fn }
}

func WithAPIHandler(fn func(appkit.APIRequest) (appkit.HTTPResponse, error)) Option {
	return func(h *Host) { h.apiHandler = fn }
}

// New 创建一个新的本地测试宿主。
func New(opts ...Option) *Host {
	h := &Host{
		config:       map[string]string{},
		settings:     map[string]any{},
		dbs:          map[string]*memDB{},
		sqlDBs:       map[string]*sql.DB{},
		migrations:   map[string][]appliedMigration{},
		kv:           map[string]map[string]kvEntry{},
		authorizedID: map[int64]bool{},
		memTxs:       map[string]*memTx{},
		sqlTxs:       map[string]*sqlTx{},
	}
	for _, opt := range opts {
		opt(h)
	}
	return h
}

// NewFromAppDir 从应用源码目录（包含 package/manifest.json 与 package/backend/migrations/）初始化本地宿主并执行迁移。
func NewFromAppDir(appDir string, opts ...Option) (*Host, error) {
	pkgDir := filepath.Join(appDir, "package")
	manifestRaw, err := os.ReadFile(filepath.Join(pkgDir, "manifest.json"))
	if err != nil {
		return nil, fmt.Errorf("read manifest.json: %w", err)
	}
	var m appspec.Manifest
	if err := json.Unmarshal(manifestRaw, &m); err != nil {
		return nil, fmt.Errorf("parse manifest.json: %w", err)
	}
	allOpts := append([]Option{WithManifest(&m)}, opts...)
	h := New(allOpts...)
	if err := h.ApplyMigrationsFromDir(filepath.Join(pkgDir, "backend", "migrations")); err != nil {
		return nil, err
	}
	return h, nil
}

// ApplyMigrationsFromDir 读取并执行 backend/migrations/<scope>/NNNN_<name>.sql：
// shared 与 public 立即执行并记入 _app_migrations；account 迁移在对应用户首次访问时按需执行。
func (h *Host) ApplyMigrationsFromDir(migrationsDir string) error {
	collected, err := loadMigrationsDir(migrationsDir)
	if err != nil {
		return err
	}
	version := "0.0.0"
	if h.manifest != nil && h.manifest.Version != "" {
		version = h.manifest.Version
	}
	for _, scope := range []string{"shared", "public"} {
		if err := h.applyScopeMigrations(scope, 0, version, collected[scope]); err != nil {
			return err
		}
	}
	h.mu.Lock()
	h.accountMigs = collected["account"]
	h.mu.Unlock()
	return nil
}

func loadMigrationsDir(dir string) (map[string][]migrationFile, error) {
	out := map[string][]migrationFile{}
	scopes, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return out, nil
	}
	if err != nil {
		return nil, err
	}
	for _, sc := range scopes {
		if !sc.IsDir() {
			continue
		}
		scope := sc.Name()
		files, err := os.ReadDir(filepath.Join(dir, scope))
		if err != nil {
			return nil, err
		}
		var list []migrationFile
		for _, f := range files {
			if f.IsDir() || !strings.HasSuffix(f.Name(), ".sql") {
				continue
			}
			full := filepath.Join(dir, scope, f.Name())
			raw, err := os.ReadFile(full)
			if err != nil {
				return nil, err
			}
			sum := sha256.Sum256(raw)
			list = append(list, migrationFile{
				ID:     strings.TrimSuffix(f.Name(), ".sql"),
				Scope:  scope,
				Path:   "backend/migrations/" + scope + "/" + f.Name(),
				SHA256: hex.EncodeToString(sum[:]),
				SQL:    string(raw),
			})
		}
		sort.Slice(list, func(i, j int) bool { return list[i].ID < list[j].ID })
		out[scope] = list
	}
	return out, nil
}

func (h *Host) applyScopeMigrations(scope string, userID int64, version string, target []migrationFile) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	key := scopeKey(scope, userID)
	applied := h.migrations[key]
	byID := make(map[string]migrationFile, len(target))
	for _, m := range target {
		byID[m.ID] = m
	}
	done := make(map[string]bool, len(applied))
	for _, rec := range applied {
		mig, exists := byID[rec.ID]
		if !exists {
			return fmt.Errorf("%s 迁移 %s 在新版本中缺失（禁止删除或降级）", scope, rec.ID)
		}
		if mig.SHA256 != rec.SHA256 {
			return fmt.Errorf("%s 迁移 %s 校验和不一致（已发布迁移不可修改）", scope, rec.ID)
		}
		done[rec.ID] = true
	}
	for _, mig := range target {
		if done[mig.ID] {
			continue
		}
		if h.sqlOpener != nil {
			db, err := h.ensureSQLDBLocked(scope, userID)
			if err != nil {
				return err
			}
			stmts, err := splitMigrationSQL(mig.SQL)
			if err != nil {
				return fmt.Errorf("%s: %w", mig.Path, err)
			}
			tx, err := db.Begin()
			if err != nil {
				return err
			}
			for _, st := range stmts {
				if _, err := tx.Exec(st); err != nil {
					_ = tx.Rollback()
					return fmt.Errorf("%s: %w", mig.Path, err)
				}
			}
			if err := tx.Commit(); err != nil {
				return err
			}
		} else {
			mdb := h.ensureMemDBLocked(key)
			snap := mdb.clone()
			if err := snap.execMigration(mig.SQL); err != nil {
				return fmt.Errorf("%s: %w", mig.Path, err)
			}
			h.dbs[key] = snap
		}
		h.migrations[key] = append(h.migrations[key], appliedMigration{
			ID: mig.ID, SHA256: mig.SHA256, AppVersion: version,
		})
	}
	return nil
}

// Do 在本地模拟宿主上下文中执行一次处理器调用，并返回响应信封。
func (h *Host) Do(req appkit.RequestEnvelope, handler appkit.Handler) (appkit.ResponseEnvelope, error) {
	if req.Context.Entry == "" {
		req.Context.Entry = "window"
	}
	if req.Context.Locale == "" {
		req.Context.Locale = "zh-CN"
	}
	if req.Context.Permissions == nil {
		req.Context.Permissions = []string{}
	}
	if req.Context.AppSlug == "" && h.manifest != nil {
		req.Context.AppSlug = h.manifest.Slug
	}
	if req.Context.User != nil && len(h.accountMigs) > 0 {
		version := "0.0.0"
		if h.manifest != nil && h.manifest.Version != "" {
			version = h.manifest.Version
		}
		if err := h.applyScopeMigrations("account", req.Context.User.ID, version, h.accountMigs); err != nil {
			return appkit.ResponseEnvelope{}, err
		}
	}
	encodedReq, err := json.Marshal(req)
	if err != nil {
		return appkit.ResponseEnvelope{}, err
	}
	h.mu.Lock()
	h.curReq = req
	h.curReqJS = encodedReq
	h.curResp = nil
	h.mu.Unlock()

	restore := appkit.SetHostAdapter(h)
	defer func() {
		h.rollbackDanglingTxs()
		restore()
	}()

	code := appkit.Dispatch(handler)
	if code != 0 {
		return appkit.ResponseEnvelope{}, fmt.Errorf("handler returned non-zero exit code %d", code)
	}
	h.mu.Lock()
	respRaw := append([]byte(nil), h.curResp...)
	h.mu.Unlock()
	if len(respRaw) == 0 {
		return appkit.ResponseEnvelope{}, errors.New("handler did not call response_write")
	}
	var env appkit.ResponseEnvelope
	if err := json.Unmarshal(respRaw, &env); err != nil {
		return appkit.ResponseEnvelope{}, err
	}
	return env, nil
}

// RunMigrate 在本地模拟宿主中执行 migrate() 生命周期钩子。
func (h *Host) RunMigrate(fromVersion, toVersion string, fn func(appkit.MigrateEvent) error) error {
	body, _ := json.Marshal(appkit.MigrateEvent{FromVersion: fromVersion, ToVersion: toVersion})
	req := appkit.RequestEnvelope{
		Method:  "POST",
		Path:    "/lifecycle/migrate",
		Headers: map[string]string{"content-type": "application/json"},
		BodyB64: base64.StdEncoding.EncodeToString(body),
		Context: appkit.RequestContext{
			Entry:       "lifecycle",
			Permissions: []string{},
			Locale:      "zh-CN",
			Route:       "/lifecycle/migrate",
			Visibility:  "app",
		},
	}
	encodedReq, _ := json.Marshal(req)
	h.mu.Lock()
	h.curReq = req
	h.curReqJS = encodedReq
	h.curResp = nil
	h.mu.Unlock()

	restore := appkit.SetHostAdapter(h)
	defer func() {
		h.rollbackDanglingTxs()
		restore()
	}()

	if code := appkit.DispatchMigrate(fn); code != 0 {
		h.mu.Lock()
		respRaw := append([]byte(nil), h.curResp...)
		h.mu.Unlock()
		var env appkit.ResponseEnvelope
		if json.Unmarshal(respRaw, &env) == nil && env.BodyB64 != "" {
			if msg, err := base64.StdEncoding.DecodeString(env.BodyB64); err == nil {
				return errors.New(string(msg))
			}
		}
		return fmt.Errorf("migrate returned non-zero code %d", code)
	}
	return nil
}

// StageUpload 将文件内容写入本地模拟目录并返回大文件直传请求信封所需的 UploadInfo。
func (h *Host) StageUpload(scope string, userID int64, filename, mediaType string, content []byte) (appkit.UploadInfo, error) {
	if h.dataDir == "" {
		dir, err := os.MkdirTemp("", "apphost-data-*")
		if err != nil {
			return appkit.UploadInfo{}, err
		}
		h.dataDir = dir
	}
	sub := scope
	if scope == "account" {
		sub = filepath.Join("users", strconv.FormatInt(userID, 10))
	}
	uploadDir := filepath.Join(h.dataDir, sub, ".uploads")
	if err := os.MkdirAll(uploadDir, 0o700); err != nil {
		return appkit.UploadInfo{}, err
	}
	sum := sha256.Sum256(content)
	hexSum := hex.EncodeToString(sum[:])
	fileID := hexSum[:16]
	diskPath := filepath.Join(uploadDir, fileID)
	if err := os.WriteFile(diskPath, content, 0o600); err != nil {
		return appkit.UploadInfo{}, err
	}
	return appkit.UploadInfo{
		Path:      appkit.DataPath(scope, ".uploads/"+fileID),
		Scope:     scope,
		Filename:  filename,
		MediaType: mediaType,
		Size:      int64(len(content)),
		SHA256:    hexSum,
	}, nil
}

func (h *Host) Logs() []LogEntry {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]LogEntry(nil), h.logs...)
}

func (h *Host) Notifications() []Notification {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]Notification(nil), h.notices...)
}

func (h *Host) Close() {
	h.mu.Lock()
	dbs := h.sqlDBs
	h.sqlDBs = map[string]*sql.DB{}
	h.mu.Unlock()
	for _, db := range dbs {
		_ = db.Close()
	}
}

// ---- 实现 appkit.HostAdapter ----

func (h *Host) ReadRequest() ([]byte, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]byte(nil), h.curReqJS...), nil
}

func (h *Host) WriteResponse(data []byte) error {
	h.mu.Lock()
	h.curResp = append([]byte(nil), data...)
	h.mu.Unlock()
	return nil
}

func (h *Host) Log(level uint32, msg []byte) error {
	h.mu.Lock()
	h.logs = append(h.logs, LogEntry{Level: level, Message: string(msg)})
	h.mu.Unlock()
	return nil
}

func (h *Host) ConfigGet(key []byte) ([]byte, error) {
	k := string(key)
	if h.manifest != nil && h.manifest.Backend != nil {
		declared := false
		for _, item := range h.manifest.Backend.Config {
			if item.Key == k {
				declared = true
				break
			}
		}
		if !declared {
			return nil, &appkit.HostError{Op: "config_get", Code: appkit.CodeDenied, Message: "config key not declared"}
		}
	}
	h.mu.Lock()
	val, ok := h.config[k]
	h.mu.Unlock()
	if !ok {
		return nil, &appkit.HostError{Op: "config_get", Code: appkit.CodeNotFound, Message: "config key not set"}
	}
	return []byte(val), nil
}

func (h *Host) checkStorageScope(scope string, needWrite bool) (userID int64, readOnly bool, err error) {
	publicOnly := h.curReq.Context.Entry == "public" || h.curReq.Context.Visibility == "public"
	if h.curReq.Context.Entry == "hook" || h.curReq.Context.Entry == "schedule" || h.curReq.Context.Entry == "lifecycle" {
		publicOnly = false
	}
	if h.manifest != nil && h.manifest.Backend != nil {
		st := h.manifest.Backend.Storage
		if st == nil {
			return 0, false, &appkit.HostError{Op: "storage", Code: appkit.CodeDenied, Message: "storage not declared"}
		}
		switch scope {
		case "shared":
			if !st.Shared {
				return 0, false, &appkit.HostError{Op: "storage", Code: appkit.CodeDenied, Message: "shared storage not declared"}
			}
		case "public":
			if !st.Public {
				return 0, false, &appkit.HostError{Op: "storage", Code: appkit.CodeDenied, Message: "public storage not declared"}
			}
		case "account":
			if !st.Account {
				return 0, false, &appkit.HostError{Op: "storage", Code: appkit.CodeDenied, Message: "account storage not declared"}
			}
		default:
			return 0, false, &appkit.HostError{Op: "storage", Code: appkit.CodeInvalid, Message: "invalid scope"}
		}
	}
	switch scope {
	case "shared":
		if publicOnly {
			return 0, false, &appkit.HostError{Op: "storage", Code: appkit.CodeDenied, Message: "public route cannot access shared storage"}
		}
		return 0, false, nil
	case "public":
		if publicOnly && needWrite {
			return 0, true, &appkit.HostError{Op: "storage", Code: appkit.CodeDenied, Message: "public storage is read-only on public routes"}
		}
		return 0, publicOnly, nil
	case "account":
		if publicOnly || h.curReq.Context.User == nil || h.curReq.Context.User.ID <= 0 {
			return 0, false, &appkit.HostError{Op: "storage", Code: appkit.CodeDenied, Message: "account storage requires signed-in user"}
		}
		return h.curReq.Context.User.ID, false, nil
	default:
		return 0, false, &appkit.HostError{Op: "storage", Code: appkit.CodeInvalid, Message: "invalid scope"}
	}
}

func (h *Host) DBCall(payload []byte) ([]byte, error) {
	var req struct {
		Scope string            `json:"scope"`
		Op    string            `json:"op"`
		Tx    string            `json:"tx"`
		SQL   string            `json:"sql"`
		Args  []json.RawMessage `json:"args"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, &appkit.HostError{Op: "db_call", Code: appkit.CodeInvalid, Message: "invalid JSON"}
	}
	h.mu.Lock()
	defer h.mu.Unlock()

	switch req.Op {
	case "begin":
		uid, ro, err := h.checkStorageScope(req.Scope, false)
		if err != nil {
			return nil, err
		}
		h.txSeq++
		id := fmt.Sprintf("tx-%d", h.txSeq)
		if h.sqlOpener != nil {
			db, err := h.ensureSQLDBLocked(req.Scope, uid)
			if err != nil {
				return nil, &appkit.HostError{Op: "db_call", Code: appkit.CodeErr, Message: err.Error()}
			}
			tx, err := db.Begin()
			if err != nil {
				return nil, &appkit.HostError{Op: "db_call", Code: appkit.CodeErr, Message: err.Error()}
			}
			h.sqlTxs[id] = &sqlTx{tx: tx, scope: req.Scope, readOnly: ro}
		} else {
			key := scopeKey(req.Scope, uid)
			h.memTxs[id] = &memTx{dbKey: key, scope: req.Scope, readOnly: ro, snapshot: h.ensureMemDBLocked(key).clone()}
		}
		out, _ := json.Marshal(map[string]any{"tx": id})
		return out, nil

	case "commit", "rollback":
		if stx, ok := h.sqlTxs[req.Tx]; ok {
			delete(h.sqlTxs, req.Tx)
			var err error
			if req.Op == "commit" {
				err = stx.tx.Commit()
			} else {
				err = stx.tx.Rollback()
			}
			if err != nil {
				return nil, &appkit.HostError{Op: "db_call", Code: appkit.CodeErr, Message: err.Error()}
			}
			return []byte(`{}`), nil
		}
		mtx, ok := h.memTxs[req.Tx]
		if !ok {
			return nil, &appkit.HostError{Op: "db_call", Code: appkit.CodeNotFound, Message: "transaction not found"}
		}
		delete(h.memTxs, req.Tx)
		if req.Op == "commit" {
			h.dbs[mtx.dbKey] = mtx.snapshot
		}
		return []byte(`{}`), nil

	case "query", "exec":
		args, err := decodeArgs(req.Args)
		if err != nil {
			return nil, &appkit.HostError{Op: "db_call", Code: appkit.CodeInvalid, Message: err.Error()}
		}
		if err := guardRuntimeSQL(req.SQL); err != nil {
			return nil, &appkit.HostError{Op: "db_call", Code: appkit.CodeDenied, Message: err.Error()}
		}
		if h.sqlOpener != nil {
			return h.handleRealSQLDBCallLocked(req.Scope, req.Tx, req.Op, req.SQL, args)
		}
		var target *memDB
		var readOnly bool
		if req.Tx != "" {
			mtx, ok := h.memTxs[req.Tx]
			if !ok {
				return nil, &appkit.HostError{Op: "db_call", Code: appkit.CodeNotFound, Message: "transaction not found"}
			}
			readOnly = mtx.readOnly
			if req.Op == "exec" && readOnly {
				return nil, &appkit.HostError{Op: "db_call", Code: appkit.CodeDenied, Message: "read-only transaction"}
			}
			target = mtx.snapshot
		} else {
			uid, ro, err := h.checkStorageScope(req.Scope, req.Op == "exec")
			if err != nil {
				return nil, err
			}
			readOnly = ro
			target = h.ensureMemDBLocked(scopeKey(req.Scope, uid))
		}
		if req.Op == "exec" {
			if readOnly {
				return nil, &appkit.HostError{Op: "db_call", Code: appkit.CodeDenied, Message: "read-only scope"}
			}
			aff, lastID, err := target.exec(req.SQL, args, false)
			if err != nil {
				return nil, &appkit.HostError{Op: "db_call", Code: appkit.CodeErr, Message: err.Error()}
			}
			out, _ := json.Marshal(map[string]any{"rows_affected": aff, "last_insert_id": lastID})
			return out, nil
		}
		cols, rows, err := target.query(req.SQL, args)
		if err != nil {
			return nil, &appkit.HostError{Op: "db_call", Code: appkit.CodeErr, Message: err.Error()}
		}
		out, _ := json.Marshal(map[string]any{"columns": cols, "rows": encodeOutputRows(rows)})
		return out, nil

	default:
		return nil, &appkit.HostError{Op: "db_call", Code: appkit.CodeInvalid, Message: "unsupported op"}
	}
}

func (h *Host) handleRealSQLDBCallLocked(scope, txID, op, query string, args []any) ([]byte, error) {
	var runner interface {
		Query(string, ...any) (*sql.Rows, error)
		Exec(string, ...any) (sql.Result, error)
	}
	if txID != "" {
		stx, ok := h.sqlTxs[txID]
		if !ok {
			return nil, &appkit.HostError{Op: "db_call", Code: appkit.CodeNotFound, Message: "transaction not found"}
		}
		if op == "exec" && stx.readOnly {
			return nil, &appkit.HostError{Op: "db_call", Code: appkit.CodeDenied, Message: "read-only transaction"}
		}
		runner = stx.tx
	} else {
		uid, _, err := h.checkStorageScope(scope, op == "exec")
		if err != nil {
			return nil, err
		}
		db, err := h.ensureSQLDBLocked(scope, uid)
		if err != nil {
			return nil, &appkit.HostError{Op: "db_call", Code: appkit.CodeErr, Message: err.Error()}
		}
		runner = db
	}
	if op == "exec" {
		res, err := runner.Exec(query, args...)
		if err != nil {
			return nil, &appkit.HostError{Op: "db_call", Code: appkit.CodeErr, Message: err.Error()}
		}
		aff, _ := res.RowsAffected()
		lastID, _ := res.LastInsertId()
		out, _ := json.Marshal(map[string]any{"rows_affected": aff, "last_insert_id": lastID})
		return out, nil
	}
	rows, err := runner.Query(query, args...)
	if err != nil {
		return nil, &appkit.HostError{Op: "db_call", Code: appkit.CodeErr, Message: err.Error()}
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return nil, &appkit.HostError{Op: "db_call", Code: appkit.CodeErr, Message: err.Error()}
	}
	resultRows := [][]any{}
	vals := make([]any, len(cols))
	ptrs := make([]any, len(cols))
	for i := range vals {
		ptrs[i] = &vals[i]
	}
	for rows.Next() {
		if err := rows.Scan(ptrs...); err != nil {
			return nil, &appkit.HostError{Op: "db_call", Code: appkit.CodeErr, Message: err.Error()}
		}
		row := make([]any, len(cols))
		copy(row, vals)
		resultRows = append(resultRows, row)
	}
	out, _ := json.Marshal(map[string]any{"columns": cols, "rows": encodeOutputRows(resultRows)})
	return out, nil
}

func (h *Host) KVCall(payload []byte) ([]byte, error) {
	var req struct {
		Scope  string          `json:"scope"`
		Op     string          `json:"op"`
		Key    string          `json:"key"`
		Value  json.RawMessage `json:"value"`
		Prefix string          `json:"prefix"`
		Limit  int             `json:"limit"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, &appkit.HostError{Op: "kv_call", Code: appkit.CodeInvalid, Message: "invalid JSON"}
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	uid, _, err := h.checkStorageScope(req.Scope, req.Op == "set" || req.Op == "delete")
	if err != nil {
		return nil, err
	}
	bucketKey := scopeKey(req.Scope, uid)
	bucket := h.kv[bucketKey]
	if bucket == nil {
		bucket = map[string]kvEntry{}
		h.kv[bucketKey] = bucket
	}
	switch req.Op {
	case "get":
		item, ok := bucket[req.Key]
		if !ok {
			return []byte(`{"found":false}`), nil
		}
		out, _ := json.Marshal(map[string]any{"found": true, "value": item.value, "updated_at": item.updatedAt})
		return out, nil
	case "set":
		now := time.Now().UnixMilli()
		bucket[req.Key] = kvEntry{value: append(json.RawMessage(nil), req.Value...), updatedAt: now}
		out, _ := json.Marshal(map[string]any{"ok": true, "updated_at": now})
		return out, nil
	case "delete":
		_, existed := bucket[req.Key]
		delete(bucket, req.Key)
		out, _ := json.Marshal(map[string]any{"deleted": existed})
		return out, nil
	case "list":
		limit := req.Limit
		if limit <= 0 {
			limit = 100
		}
		var keys []string
		for k := range bucket {
			if strings.HasPrefix(k, req.Prefix) {
				keys = append(keys, k)
			}
		}
		sort.Strings(keys)
		hasMore := len(keys) > limit
		if hasMore {
			keys = keys[:limit]
		}
		items := make([]appkit.KVItem, 0, len(keys))
		for _, k := range keys {
			items = append(items, appkit.KVItem{Key: k, Value: bucket[k].value, UpdatedAt: bucket[k].updatedAt})
		}
		out, _ := json.Marshal(map[string]any{"items": items, "has_more": hasMore})
		return out, nil
	default:
		return nil, &appkit.HostError{Op: "kv_call", Code: appkit.CodeInvalid, Message: "unsupported kv op"}
	}
}

func (h *Host) HTTPFetch(payload []byte) ([]byte, error) {
	if h.manifest != nil && (h.manifest.Backend == nil || h.manifest.Backend.HTTP == nil || len(h.manifest.Backend.HTTP.Allow) == 0) {
		return nil, &appkit.HostError{Op: "http_fetch", Code: appkit.CodeDenied, Message: "backend.http.allow not declared"}
	}
	var wire struct {
		Method    string            `json:"method"`
		URL       string            `json:"url"`
		Headers   map[string]string `json:"headers"`
		BodyB64   string            `json:"body_b64"`
		TimeoutMS int               `json:"timeout_ms"`
	}
	if err := json.Unmarshal(payload, &wire); err != nil {
		return nil, &appkit.HostError{Op: "http_fetch", Code: appkit.CodeInvalid, Message: "invalid JSON"}
	}
	if h.httpHandler == nil {
		return nil, &appkit.HostError{Op: "http_fetch", Code: appkit.CodeErr, Message: "no mock HTTP handler configured"}
	}
	var body []byte
	if wire.BodyB64 != "" {
		body, _ = base64.StdEncoding.DecodeString(wire.BodyB64)
	}
	resp, err := h.httpHandler(appkit.HTTPRequest{
		Method: wire.Method, URL: wire.URL, Headers: wire.Headers, Body: body, TimeoutMS: wire.TimeoutMS,
	})
	if err != nil {
		return nil, &appkit.HostError{Op: "http_fetch", Code: appkit.CodeErr, Message: err.Error()}
	}
	return encodeWireHTTP(resp), nil
}

func (h *Host) ProxyFetch(payload []byte) ([]byte, error) {
	if h.manifest != nil && len(h.manifest.Proxies) == 0 {
		return nil, &appkit.HostError{Op: "proxy_fetch", Code: appkit.CodeDenied, Message: "proxies not declared"}
	}
	var wire struct {
		Proxy   string            `json:"proxy"`
		Method  string            `json:"method"`
		Path    string            `json:"path"`
		Query   string            `json:"query"`
		Headers map[string]string `json:"headers"`
		BodyB64 string            `json:"body_b64"`
	}
	if err := json.Unmarshal(payload, &wire); err != nil {
		return nil, &appkit.HostError{Op: "proxy_fetch", Code: appkit.CodeInvalid, Message: "invalid JSON"}
	}
	if h.proxyHandler == nil {
		return nil, &appkit.HostError{Op: "proxy_fetch", Code: appkit.CodeErr, Message: "no mock proxy handler configured"}
	}
	var body []byte
	if wire.BodyB64 != "" {
		body, _ = base64.StdEncoding.DecodeString(wire.BodyB64)
	}
	resp, err := h.proxyHandler(appkit.ProxyRequest{
		Proxy: wire.Proxy, Method: wire.Method, Path: wire.Path, Query: wire.Query, Headers: wire.Headers, Body: body,
	})
	if err != nil {
		return nil, &appkit.HostError{Op: "proxy_fetch", Code: appkit.CodeErr, Message: err.Error()}
	}
	return encodeWireHTTP(resp), nil
}

func (h *Host) APICall(payload []byte) ([]byte, error) {
	if h.curReq.Context.User == nil {
		return nil, &appkit.HostError{Op: "api_call", Code: appkit.CodeDenied, Message: "api_call requires authenticated user"}
	}
	if h.manifest != nil && len(h.manifest.GatewayAPI) == 0 {
		return nil, &appkit.HostError{Op: "api_call", Code: appkit.CodeDenied, Message: "gateway_api not declared"}
	}
	var wire struct {
		Method  string            `json:"method"`
		Path    string            `json:"path"`
		Query   string            `json:"query"`
		Headers map[string]string `json:"headers"`
		BodyB64 string            `json:"body_b64"`
	}
	if err := json.Unmarshal(payload, &wire); err != nil {
		return nil, &appkit.HostError{Op: "api_call", Code: appkit.CodeInvalid, Message: "invalid JSON"}
	}
	if h.apiHandler == nil {
		return nil, &appkit.HostError{Op: "api_call", Code: appkit.CodeErr, Message: "no mock API handler configured"}
	}
	var body []byte
	if wire.BodyB64 != "" {
		body, _ = base64.StdEncoding.DecodeString(wire.BodyB64)
	}
	resp, err := h.apiHandler(appkit.APIRequest{
		Method: wire.Method, Path: wire.Path, Query: wire.Query, Headers: wire.Headers, Body: body,
	})
	if err != nil {
		return nil, &appkit.HostError{Op: "api_call", Code: appkit.CodeErr, Message: err.Error()}
	}
	return encodeWireHTTP(resp), nil
}

func (h *Host) PlatformCall(payload []byte) ([]byte, error) {
	var req struct {
		Action string          `json:"action"`
		Params json.RawMessage `json:"params"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, &appkit.HostError{Op: "platform_call", Code: appkit.CodeInvalid, Message: "invalid JSON"}
	}
	switch req.Action {
	case "settings.get":
		if h.manifest != nil {
			if h.manifest.Platform == nil {
				return nil, &appkit.HostError{Op: "platform_call", Code: appkit.CodeDenied, Message: "platform not declared"}
			}
			if _, ok := h.manifest.Platform.Provides["settings"]; !ok {
				return nil, &appkit.HostError{Op: "platform_call", Code: appkit.CodeDenied, Message: "provides.settings not declared"}
			}
		}
		h.mu.Lock()
		vals := h.settings
		h.mu.Unlock()
		out, _ := json.Marshal(map[string]any{"values": vals, "updated_at": time.Now().UnixMilli()})
		return out, nil

	case "identity.me":
		if h.manifest != nil && (h.manifest.Platform == nil || !slices.Contains(h.manifest.Platform.Uses, "identity")) {
			return nil, &appkit.HostError{Op: "platform_call", Code: appkit.CodeDenied, Message: "identity not declared"}
		}
		if h.curReq.Context.User == nil {
			return nil, &appkit.HostError{Op: "platform_call", Code: appkit.CodeDenied, Message: "no authenticated user"}
		}
		out, _ := json.Marshal(appkit.Identity{
			ID:          h.curReq.Context.User.ID,
			DisplayName: h.curReq.Context.User.DisplayName,
		})
		return out, nil

	case "notify.send":
		if h.manifest != nil && (h.manifest.Platform == nil || !slices.Contains(h.manifest.Platform.Uses, "notify")) {
			return nil, &appkit.HostError{Op: "platform_call", Code: appkit.CodeDenied, Message: "notify not declared"}
		}
		var p struct {
			Title  string `json:"title"`
			Body   string `json:"body"`
			UserID int64  `json:"user_id"`
		}
		if err := json.Unmarshal(req.Params, &p); err != nil || strings.TrimSpace(p.Title) == "" {
			return nil, &appkit.HostError{Op: "platform_call", Code: appkit.CodeInvalid, Message: "invalid notify params"}
		}
		targetID := p.UserID
		if targetID == 0 && h.curReq.Context.User != nil {
			targetID = h.curReq.Context.User.ID
		}
		if targetID <= 0 {
			return nil, &appkit.HostError{Op: "platform_call", Code: appkit.CodeInvalid, Message: "missing user_id"}
		}
		h.mu.Lock()
		if len(h.authorizedID) > 0 && !h.authorizedID[targetID] {
			h.mu.Unlock()
			return nil, &appkit.HostError{Op: "platform_call", Code: appkit.CodeDenied, Message: "target user not authorized"}
		}
		h.notices = append(h.notices, Notification{UserID: targetID, Title: p.Title, Body: p.Body})
		h.mu.Unlock()
		return []byte(`{"ok":true}`), nil

	default:
		return nil, &appkit.HostError{Op: "platform_call", Code: appkit.CodeInvalid, Message: "unknown platform action"}
	}
}

func (h *Host) rollbackDanglingTxs() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for id, stx := range h.sqlTxs {
		_ = stx.tx.Rollback()
		delete(h.sqlTxs, id)
	}
	for id := range h.memTxs {
		delete(h.memTxs, id)
	}
}

func (h *Host) ensureMemDBLocked(key string) *memDB {
	db := h.dbs[key]
	if db == nil {
		db = newMemDB()
		h.dbs[key] = db
	}
	return db
}

func (h *Host) ensureSQLDBLocked(scope string, userID int64) (*sql.DB, error) {
	key := scopeKey(scope, userID)
	if db := h.sqlDBs[key]; db != nil {
		return db, nil
	}
	db, err := h.sqlOpener(scope, userID)
	if err != nil {
		return nil, err
	}
	h.sqlDBs[key] = db
	return db, nil
}

func scopeKey(scope string, userID int64) string {
	if scope == "account" {
		return fmt.Sprintf("account:%d", userID)
	}
	return scope
}

func guardRuntimeSQL(rawSQL string) error {
	lower := strings.ToLower(rawSQL)
	for _, forbidden := range []string{"_app_migrations", "_app_kv", "attach ", "detach ", "vacuum", "pragma ", "load_extension"} {
		if strings.Contains(lower, forbidden) {
			return fmt.Errorf("forbidden SQL construct %q at runtime", strings.TrimSpace(forbidden))
		}
	}
	return nil
}

func decodeArgs(raw []json.RawMessage) ([]any, error) {
	out := make([]any, len(raw))
	for i, item := range raw {
		trimmed := bytes.TrimSpace(item)
		if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
			out[i] = nil
			continue
		}
		dec := json.NewDecoder(bytes.NewReader(trimmed))
		dec.UseNumber()
		var val any
		if err := dec.Decode(&val); err != nil {
			return nil, err
		}
		switch v := val.(type) {
		case json.Number:
			if iv, err := v.Int64(); err == nil {
				out[i] = iv
			} else if fv, err := v.Float64(); err == nil {
				out[i] = fv
			} else {
				out[i] = v.String()
			}
		case bool:
			if v {
				out[i] = int64(1)
			} else {
				out[i] = int64(0)
			}
		case map[string]any:
			if b64, ok := v["$blob_b64"].(string); ok {
				decoded, err := base64.StdEncoding.DecodeString(b64)
				if err != nil {
					return nil, err
				}
				out[i] = decoded
			} else {
				return nil, errors.New("unsupported object parameter")
			}
		default:
			out[i] = v
		}
	}
	return out, nil
}

func encodeOutputRows(rows [][]any) [][]any {
	out := make([][]any, len(rows))
	for i, r := range rows {
		row := make([]any, len(r))
		for j, cell := range r {
			if b, ok := cell.([]byte); ok {
				row[j] = map[string]string{"$blob_b64": base64.StdEncoding.EncodeToString(b)}
			} else {
				row[j] = cell
			}
		}
		out[i] = row
	}
	return out
}

func encodeWireHTTP(resp appkit.HTTPResponse) []byte {
	wire := struct {
		Status  int               `json:"status"`
		Headers map[string]string `json:"headers,omitempty"`
		BodyB64 string            `json:"body_b64,omitempty"`
	}{
		Status:  resp.Status,
		Headers: resp.Headers,
	}
	if len(resp.Body) > 0 {
		wire.BodyB64 = base64.StdEncoding.EncodeToString(resp.Body)
	}
	b, _ := json.Marshal(wire)
	return b
}

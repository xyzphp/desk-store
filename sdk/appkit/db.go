package appkit

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"time"
)

// DBQueryResult 是低层 db_call("query") 的结果。
type DBQueryResult struct {
	Columns []string `json:"columns"`
	Rows    [][]any  `json:"rows"`
}

// DBExecResult 是低层 db_call("exec") 的结果。
type DBExecResult struct {
	RowsAffected int64 `json:"rows_affected"`
	LastInsertID int64 `json:"last_insert_id"`
}

type dbCallPayload struct {
	Scope string `json:"scope,omitempty"`
	Op    string `json:"op"`
	Tx    string `json:"tx,omitempty"`
	SQL   string `json:"sql,omitempty"`
	Args  []any  `json:"args,omitempty"`
}

// Blob 将二进制字节切片编码为 ABI 1 的 {"$blob_b64": "..."} 参数对象。
func Blob(data []byte) map[string]string {
	return map[string]string{"$blob_b64": base64.StdEncoding.EncodeToString(data)}
}

// DecodeBlob 从 db_call 查询结果单元格解码二进制字段。
func DecodeBlob(val any) ([]byte, bool) {
	switch v := val.(type) {
	case []byte:
		return v, true
	case map[string]any:
		if b64, ok := v["$blob_b64"].(string); ok {
			decoded, err := base64.StdEncoding.DecodeString(b64)
			if err == nil {
				return decoded, true
			}
		}
	}
	return nil, false
}

// ScopeDB 提供直接调用 host.db_call 的轻量封装。
type ScopeDB struct {
	scope string
}

// DB 返回指定范围（shared / public / account）的轻量数据库客户端。
func DB(scope string) *ScopeDB {
	return &ScopeDB{scope: scope}
}

func (d *ScopeDB) Query(query string, args ...any) (*DBQueryResult, error) {
	return execDBQuery(d.scope, "", query, args)
}

func (d *ScopeDB) Exec(query string, args ...any) (DBExecResult, error) {
	return execDBExec(d.scope, "", query, args)
}

func (d *ScopeDB) Begin() (*DBTx, error) {
	txID, err := execDBBegin(d.scope)
	if err != nil {
		return nil, err
	}
	return &DBTx{scope: d.scope, id: txID}, nil
}

// DBTx 表示一次请求内的应用数据库事务。
type DBTx struct {
	scope string
	id    string
}

func (t *DBTx) Query(query string, args ...any) (*DBQueryResult, error) {
	return execDBQuery(t.scope, t.id, query, args)
}

func (t *DBTx) Exec(query string, args ...any) (DBExecResult, error) {
	return execDBExec(t.scope, t.id, query, args)
}

func (t *DBTx) Commit() error {
	return execDBEnd(t.scope, t.id, "commit")
}

func (t *DBTx) Rollback() error {
	return execDBEnd(t.scope, t.id, "rollback")
}

func encodeDBArgs(args []any) []any {
	if len(args) == 0 {
		return nil
	}
	out := make([]any, len(args))
	for i, arg := range args {
		switch v := arg.(type) {
		case []byte:
			out[i] = Blob(v)
		case time.Time:
			out[i] = v.UTC().Format(time.RFC3339Nano)
		default:
			out[i] = v
		}
	}
	return out
}

func execDBBegin(scope string) (string, error) {
	raw, err := json.Marshal(dbCallPayload{Scope: scope, Op: "begin"})
	if err != nil {
		return "", err
	}
	resp, err := abiDBCall(raw)
	if err != nil {
		return "", err
	}
	var out struct {
		Tx string `json:"tx"`
	}
	if err := json.Unmarshal(resp, &out); err != nil {
		return "", err
	}
	return out.Tx, nil
}

func execDBEnd(scope, txID, op string) error {
	raw, err := json.Marshal(dbCallPayload{Scope: scope, Op: op, Tx: txID})
	if err != nil {
		return err
	}
	_, err = abiDBCall(raw)
	return err
}

func execDBExec(scope, txID, query string, args []any) (DBExecResult, error) {
	raw, err := json.Marshal(dbCallPayload{
		Scope: scope,
		Op:    "exec",
		Tx:    txID,
		SQL:   query,
		Args:  encodeDBArgs(args),
	})
	if err != nil {
		return DBExecResult{}, err
	}
	resp, err := abiDBCall(raw)
	if err != nil {
		return DBExecResult{}, err
	}
	var out DBExecResult
	if err := json.Unmarshal(resp, &out); err != nil {
		return DBExecResult{}, err
	}
	return out, nil
}

func execDBQuery(scope, txID, query string, args []any) (*DBQueryResult, error) {
	raw, err := json.Marshal(dbCallPayload{
		Scope: scope,
		Op:    "query",
		Tx:    txID,
		SQL:   query,
		Args:  encodeDBArgs(args),
	})
	if err != nil {
		return nil, err
	}
	resp, err := abiDBCall(raw)
	if err != nil {
		return nil, err
	}
	dec := json.NewDecoder(bytes.NewReader(resp))
	dec.UseNumber()
	var out DBQueryResult
	if err := dec.Decode(&out); err != nil {
		return nil, err
	}
	for r := range out.Rows {
		for c, cell := range out.Rows[r] {
			out.Rows[r][c] = normalizeDBCell(cell)
		}
	}
	return &out, nil
}

func normalizeDBCell(val any) any {
	switch v := val.(type) {
	case nil:
		return nil
	case json.Number:
		if iv, err := v.Int64(); err == nil {
			return iv
		}
		if fv, err := v.Float64(); err == nil {
			return fv
		}
		return v.String()
	case map[string]any:
		if blob, ok := DecodeBlob(v); ok {
			return blob
		}
		return v
	default:
		return v
	}
}

// ---- database/sql 驱动（通过 OpenDB 按需构造，避免 init() 强制引入 host.db_call） ----

// OpenDB 返回基于 host.db_call 的标准 *sql.DB（scope 为 "shared"、"public" 或 "account"）。
func OpenDB(scope string) *sql.DB {
	db := sql.OpenDB(&appDBConnector{scope: scope})
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	return db
}

type appDBConnector struct {
	scope string
}

func (c *appDBConnector) Connect(context.Context) (driver.Conn, error) {
	return &appDBConn{scope: c.scope}, nil
}

func (c *appDBConnector) Driver() driver.Driver {
	return appDBDriver{}
}

type appDBDriver struct{}

func (appDBDriver) Open(name string) (driver.Conn, error) {
	return &appDBConn{scope: name}, nil
}

type appDBConn struct {
	scope string
	txID  string
}

func (c *appDBConn) Prepare(query string) (driver.Stmt, error) {
	return &appDBStmt{conn: c, query: query}, nil
}

func (c *appDBConn) PrepareContext(_ context.Context, query string) (driver.Stmt, error) {
	return &appDBStmt{conn: c, query: query}, nil
}

func (c *appDBConn) Close() error {
	if c.txID != "" {
		_ = execDBEnd(c.scope, c.txID, "rollback")
		c.txID = ""
	}
	return nil
}

func (c *appDBConn) Begin() (driver.Tx, error) {
	return c.BeginTx(context.Background(), driver.TxOptions{})
}

func (c *appDBConn) BeginTx(_ context.Context, _ driver.TxOptions) (driver.Tx, error) {
	if c.txID != "" {
		return nil, errors.New("transaction already active on connection")
	}
	id, err := execDBBegin(c.scope)
	if err != nil {
		return nil, err
	}
	c.txID = id
	return &appDBDriverTx{conn: c, id: id}, nil
}

func (c *appDBConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	plain, err := namedValuesToAny(args)
	if err != nil {
		return nil, err
	}
	res, err := execDBExec(c.scope, c.txID, query, plain)
	if err != nil {
		return nil, err
	}
	return appDBDriverResult{res: res}, nil
}

func (c *appDBConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	plain, err := namedValuesToAny(args)
	if err != nil {
		return nil, err
	}
	res, err := execDBQuery(c.scope, c.txID, query, plain)
	if err != nil {
		return nil, err
	}
	return &appDBDriverRows{columns: res.Columns, rows: res.Rows}, nil
}

type appDBDriverTx struct {
	conn *appDBConn
	id   string
}

func (t *appDBDriverTx) Commit() error {
	t.conn.txID = ""
	return execDBEnd(t.conn.scope, t.id, "commit")
}

func (t *appDBDriverTx) Rollback() error {
	t.conn.txID = ""
	return execDBEnd(t.conn.scope, t.id, "rollback")
}

type appDBStmt struct {
	conn  *appDBConn
	query string
}

func (s *appDBStmt) Close() error  { return nil }
func (s *appDBStmt) NumInput() int { return -1 }

func (s *appDBStmt) Exec(args []driver.Value) (driver.Result, error) {
	plain := make([]any, len(args))
	for i, v := range args {
		plain[i] = v
	}
	res, err := execDBExec(s.conn.scope, s.conn.txID, s.query, plain)
	if err != nil {
		return nil, err
	}
	return appDBDriverResult{res: res}, nil
}

func (s *appDBStmt) ExecContext(ctx context.Context, args []driver.NamedValue) (driver.Result, error) {
	return s.conn.ExecContext(ctx, s.query, args)
}

func (s *appDBStmt) Query(args []driver.Value) (driver.Rows, error) {
	plain := make([]any, len(args))
	for i, v := range args {
		plain[i] = v
	}
	res, err := execDBQuery(s.conn.scope, s.conn.txID, s.query, plain)
	if err != nil {
		return nil, err
	}
	return &appDBDriverRows{columns: res.Columns, rows: res.Rows}, nil
}

func (s *appDBStmt) QueryContext(ctx context.Context, args []driver.NamedValue) (driver.Rows, error) {
	return s.conn.QueryContext(ctx, s.query, args)
}

type appDBDriverResult struct {
	res DBExecResult
}

func (r appDBDriverResult) LastInsertId() (int64, error) { return r.res.LastInsertID, nil }
func (r appDBDriverResult) RowsAffected() (int64, error) { return r.res.RowsAffected, nil }

type appDBDriverRows struct {
	columns []string
	rows    [][]any
	idx     int
}

func (r *appDBDriverRows) Columns() []string { return r.columns }
func (r *appDBDriverRows) Close() error      { return nil }

func (r *appDBDriverRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.rows) {
		return io.EOF
	}
	row := r.rows[r.idx]
	r.idx++
	for i := range dest {
		if i >= len(row) {
			dest[i] = nil
			continue
		}
		dest[i] = toDriverValue(row[i])
	}
	return nil
}

func namedValuesToAny(args []driver.NamedValue) ([]any, error) {
	if len(args) == 0 {
		return nil, nil
	}
	out := make([]any, len(args))
	for i, arg := range args {
		if arg.Name != "" {
			return nil, fmt.Errorf("named SQL parameters are not supported: %s", arg.Name)
		}
		out[i] = arg.Value
	}
	return out, nil
}

func toDriverValue(v any) driver.Value {
	switch x := v.(type) {
	case nil, int64, float64, bool, []byte, string, time.Time:
		return x
	case int:
		return int64(x)
	default:
		return fmt.Sprint(x)
	}
}

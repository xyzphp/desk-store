package apphost

import (
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// memDB 是零外部依赖的轻量内存 SQLite 子集引擎，支持常见迁移 DDL 与业务 CRUD / 事务，
// 供本地运行器在不引入第三方 C/Go SQLite 驱动时开箱即用；需要完整 SQLite 语法时可通过 WithSQLOpener 接入真实驱动。
type memDB struct {
	tables map[string]*memTable
}

type memTable struct {
	name    string
	columns []memColumn
	pkCol   string
	autoInc bool
	nextID  int64
	rows    []map[string]any
}

type memColumn struct {
	name       string
	primaryKey bool
	notNull    bool
	unique     bool
	hasDefault bool
	defaultVal any
}

func newMemDB() *memDB {
	return &memDB{tables: map[string]*memTable{}}
}

func (db *memDB) clone() *memDB {
	cp := &memDB{tables: make(map[string]*memTable, len(db.tables))}
	for name, tbl := range db.tables {
		cols := append([]memColumn(nil), tbl.columns...)
		rows := make([]map[string]any, len(tbl.rows))
		for i, row := range tbl.rows {
			rc := make(map[string]any, len(row))
			for k, v := range row {
				if b, ok := v.([]byte); ok {
					bc := make([]byte, len(b))
					copy(bc, b)
					rc[k] = bc
				} else {
					rc[k] = v
				}
			}
			rows[i] = rc
		}
		cp.tables[name] = &memTable{
			name: tbl.name, columns: cols, pkCol: tbl.pkCol, autoInc: tbl.autoInc, nextID: tbl.nextID, rows: rows,
		}
	}
	return cp
}

func (db *memDB) execMigration(rawSQL string) error {
	stmts, err := splitMigrationSQL(rawSQL)
	if err != nil {
		return err
	}
	for _, stmt := range stmts {
		if _, _, err := db.exec(stmt, nil, true); err != nil {
			return err
		}
	}
	return nil
}

func (db *memDB) exec(rawSQL string, args []any, allowDDL bool) (rowsAffected int64, lastInsertID int64, err error) {
	sqlText := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(rawSQL), ";"))
	if sqlText == "" {
		return 0, 0, nil
	}
	upper := strings.ToUpper(sqlText)
	switch {
	case strings.HasPrefix(upper, "PRAGMA "):
		if !allowDDL {
			return 0, 0, errors.New("PRAGMA is forbidden at runtime")
		}
		return 0, 0, nil
	case strings.HasPrefix(upper, "CREATE INDEX ") || strings.HasPrefix(upper, "CREATE UNIQUE INDEX "):
		if !allowDDL {
			return 0, 0, errors.New("DDL is forbidden at runtime")
		}
		return 0, 0, nil
	case strings.HasPrefix(upper, "CREATE TABLE "):
		if !allowDDL {
			return 0, 0, errors.New("DDL is forbidden at runtime")
		}
		return 0, 0, db.execCreateTable(sqlText)
	case strings.HasPrefix(upper, "ALTER TABLE "):
		if !allowDDL {
			return 0, 0, errors.New("DDL is forbidden at runtime")
		}
		return 0, 0, db.execAlterTable(sqlText)
	case strings.HasPrefix(upper, "DROP TABLE "):
		if !allowDDL {
			return 0, 0, errors.New("DDL is forbidden at runtime")
		}
		return 0, 0, db.execDropTable(sqlText)
	case strings.HasPrefix(upper, "INSERT "):
		return db.execInsert(sqlText, args)
	case strings.HasPrefix(upper, "UPDATE "):
		n, err := db.execUpdate(sqlText, args)
		return n, 0, err
	case strings.HasPrefix(upper, "DELETE "):
		n, err := db.execDelete(sqlText, args)
		return n, 0, err
	default:
		return 0, 0, fmt.Errorf("unsupported SQL statement in memDB: %s", firstWord(sqlText))
	}
}

func (db *memDB) execCreateTable(stmt string) error {
	rest := strings.TrimSpace(stmt[len("CREATE TABLE"):])
	ifNotExists := false
	if strings.HasPrefix(strings.ToUpper(rest), "IF NOT EXISTS") {
		ifNotExists = true
		rest = strings.TrimSpace(rest[len("IF NOT EXISTS"):])
	}
	openIdx := strings.IndexByte(rest, '(')
	closeIdx := strings.LastIndexByte(rest, ')')
	if openIdx <= 0 || closeIdx <= openIdx {
		return errors.New("invalid CREATE TABLE syntax")
	}
	tblName := strings.ToLower(unquoteIdent(strings.TrimSpace(rest[:openIdx])))
	if _, exists := db.tables[tblName]; exists {
		if ifNotExists {
			return nil
		}
		return fmt.Errorf("table %s already exists", tblName)
	}
	body := rest[openIdx+1 : closeIdx]
	parts := splitTopLevelComma(body)
	tbl := &memTable{name: tblName}
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		up := strings.ToUpper(part)
		if strings.HasPrefix(up, "PRIMARY KEY") || strings.HasPrefix(up, "FOREIGN KEY") ||
			strings.HasPrefix(up, "UNIQUE") || strings.HasPrefix(up, "CHECK") || strings.HasPrefix(up, "CONSTRAINT") {
			continue
		}
		col, autoInc, err := parseColumnDef(part)
		if err != nil {
			return err
		}
		if col.primaryKey {
			tbl.pkCol = col.name
			tbl.autoInc = autoInc || strings.Contains(up, "INTEGER PRIMARY KEY")
		}
		tbl.columns = append(tbl.columns, col)
	}
	db.tables[tblName] = tbl
	return nil
}

func (db *memDB) execAlterTable(stmt string) error {
	rest := strings.TrimSpace(stmt[len("ALTER TABLE"):])
	fields := strings.Fields(rest)
	if len(fields) < 4 {
		return errors.New("invalid ALTER TABLE syntax")
	}
	tblName := strings.ToLower(unquoteIdent(fields[0]))
	tbl, ok := db.tables[tblName]
	if !ok {
		return fmt.Errorf("no such table: %s", tblName)
	}
	afterTbl := strings.TrimSpace(rest[len(fields[0]):])
	upperAfter := strings.ToUpper(afterTbl)
	if !strings.HasPrefix(upperAfter, "ADD COLUMN ") && !strings.HasPrefix(upperAfter, "ADD ") {
		return fmt.Errorf("unsupported ALTER TABLE operation: %s", afterTbl)
	}
	colSpec := strings.TrimSpace(afterTbl[len("ADD"):])
	if strings.HasPrefix(strings.ToUpper(colSpec), "COLUMN ") {
		colSpec = strings.TrimSpace(colSpec[len("COLUMN"):])
	}
	col, _, err := parseColumnDef(colSpec)
	if err != nil {
		return err
	}
	for _, existing := range tbl.columns {
		if existing.name == col.name {
			return fmt.Errorf("duplicate column name: %s", col.name)
		}
	}
	tbl.columns = append(tbl.columns, col)
	for _, row := range tbl.rows {
		if col.hasDefault {
			row[col.name] = col.defaultVal
		} else {
			row[col.name] = nil
		}
	}
	return nil
}

func (db *memDB) execDropTable(stmt string) error {
	rest := strings.TrimSpace(stmt[len("DROP TABLE"):])
	ifExists := false
	if strings.HasPrefix(strings.ToUpper(rest), "IF EXISTS") {
		ifExists = true
		rest = strings.TrimSpace(rest[len("IF EXISTS"):])
	}
	tblName := strings.ToLower(unquoteIdent(strings.TrimSpace(rest)))
	if _, ok := db.tables[tblName]; !ok && !ifExists {
		return fmt.Errorf("no such table: %s", tblName)
	}
	delete(db.tables, tblName)
	return nil
}

func parseColumnDef(spec string) (memColumn, bool, error) {
	toks := splitSQLTokens(spec)
	if len(toks) == 0 {
		return memColumn{}, false, errors.New("empty column definition")
	}
	col := memColumn{name: strings.ToLower(unquoteIdent(toks[0]))}
	autoInc := false
	for i := 1; i < len(toks); i++ {
		up := strings.ToUpper(toks[i])
		switch up {
		case "PRIMARY":
			if i+1 < len(toks) && strings.EqualFold(toks[i+1], "KEY") {
				col.primaryKey = true
				i++
			}
		case "AUTOINCREMENT":
			autoInc = true
		case "NOT":
			if i+1 < len(toks) && strings.EqualFold(toks[i+1], "NULL") {
				col.notNull = true
				i++
			}
		case "UNIQUE":
			col.unique = true
		case "DEFAULT":
			if i+1 < len(toks) {
				i++
				col.hasDefault = true
				col.defaultVal = parseLiteral(toks[i])
			}
		}
	}
	return col, autoInc, nil
}

func (db *memDB) execInsert(stmt string, args []any) (int64, int64, error) {
	rest := strings.TrimSpace(stmt[len("INSERT"):])
	mode := ""
	up := strings.ToUpper(rest)
	switch {
	case strings.HasPrefix(up, "OR REPLACE "):
		mode = "replace"
		rest = strings.TrimSpace(rest[len("OR REPLACE"):])
	case strings.HasPrefix(up, "OR IGNORE "):
		mode = "ignore"
		rest = strings.TrimSpace(rest[len("OR IGNORE"):])
	}
	if !strings.HasPrefix(strings.ToUpper(rest), "INTO ") {
		return 0, 0, errors.New("invalid INSERT syntax")
	}
	rest = strings.TrimSpace(rest[len("INTO"):])
	valIdx := indexKeywordOutsideQuotes(rest, "VALUES")
	if valIdx < 0 {
		return 0, 0, errors.New("INSERT requires VALUES")
	}
	head := strings.TrimSpace(rest[:valIdx])
	tail := strings.TrimSpace(rest[valIdx+len("VALUES"):])

	var tblName string
	var colNames []string
	if paren := strings.IndexByte(head, '('); paren >= 0 {
		endParen := strings.LastIndexByte(head, ')')
		if endParen <= paren {
			return 0, 0, errors.New("invalid INSERT column list")
		}
		tblName = strings.ToLower(unquoteIdent(strings.TrimSpace(head[:paren])))
		for _, c := range splitTopLevelComma(head[paren+1 : endParen]) {
			colNames = append(colNames, strings.ToLower(unquoteIdent(strings.TrimSpace(c))))
		}
	} else {
		tblName = strings.ToLower(unquoteIdent(head))
	}
	tbl, ok := db.tables[tblName]
	if !ok {
		return 0, 0, fmt.Errorf("no such table: %s", tblName)
	}
	if len(colNames) == 0 {
		for _, c := range tbl.columns {
			colNames = append(colNames, c.name)
		}
	}
	// 处理可选 ON CONFLICT(...) DO UPDATE SET ...
	conflictIdx := indexKeywordOutsideQuotes(tail, "ON CONFLICT")
	valPart := tail
	if conflictIdx >= 0 {
		valPart = strings.TrimSpace(tail[:conflictIdx])
		mode = "replace"
	}
	open := strings.IndexByte(valPart, '(')
	closeIdx := strings.LastIndexByte(valPart, ')')
	if open < 0 || closeIdx <= open {
		return 0, 0, errors.New("invalid INSERT VALUES")
	}
	valExprs := splitTopLevelComma(valPart[open+1 : closeIdx])
	if len(valExprs) != len(colNames) {
		return 0, 0, fmt.Errorf("INSERT column count (%d) != value count (%d)", len(colNames), len(valExprs))
	}
	row := make(map[string]any, len(tbl.columns))
	for _, c := range tbl.columns {
		if c.hasDefault {
			row[c.name] = c.defaultVal
		} else {
			row[c.name] = nil
		}
	}
	argIdx := 0
	for i, expr := range valExprs {
		val, nextIdx, err := evalValueExpr(strings.TrimSpace(expr), nil, args, argIdx)
		if err != nil {
			return 0, 0, err
		}
		argIdx = nextIdx
		row[colNames[i]] = val
	}
	var lastID int64
	if tbl.pkCol != "" && tbl.autoInc {
		if row[tbl.pkCol] == nil {
			tbl.nextID++
			row[tbl.pkCol] = tbl.nextID
			lastID = tbl.nextID
		} else if id, ok := asInt64(row[tbl.pkCol]); ok {
			if id > tbl.nextID {
				tbl.nextID = id
			}
			lastID = id
		}
	}
	// 检查主键/唯一键冲突
	if tbl.pkCol != "" && row[tbl.pkCol] != nil {
		for idx, existing := range tbl.rows {
			if equalSQLValues(existing[tbl.pkCol], row[tbl.pkCol]) {
				switch mode {
				case "ignore":
					return 0, 0, nil
				case "replace":
					tbl.rows[idx] = row
					return 1, lastID, nil
				default:
					return 0, 0, fmt.Errorf("UNIQUE constraint failed: %s.%s", tbl.name, tbl.pkCol)
				}
			}
		}
	}
	tbl.rows = append(tbl.rows, row)
	return 1, lastID, nil
}

func (db *memDB) execUpdate(stmt string, args []any) (int64, error) {
	rest := strings.TrimSpace(stmt[len("UPDATE"):])
	setIdx := indexKeywordOutsideQuotes(rest, "SET")
	if setIdx <= 0 {
		return 0, errors.New("UPDATE requires SET")
	}
	tblName := strings.ToLower(unquoteIdent(strings.TrimSpace(rest[:setIdx])))
	tbl, ok := db.tables[tblName]
	if !ok {
		return 0, fmt.Errorf("no such table: %s", tblName)
	}
	afterSet := strings.TrimSpace(rest[setIdx+len("SET"):])
	whereIdx := indexKeywordOutsideQuotes(afterSet, "WHERE")
	setPart := afterSet
	wherePart := ""
	if whereIdx >= 0 {
		setPart = strings.TrimSpace(afterSet[:whereIdx])
		wherePart = strings.TrimSpace(afterSet[whereIdx+len("WHERE"):])
	}
	assignments := splitTopLevelComma(setPart)
	type assign struct {
		col  string
		expr string
	}
	var assigns []assign
	setArgCount := 0
	for _, a := range assignments {
		eq := strings.IndexByte(a, '=')
		if eq <= 0 {
			return 0, errors.New("invalid UPDATE assignment")
		}
		col := strings.ToLower(unquoteIdent(strings.TrimSpace(a[:eq])))
		expr := strings.TrimSpace(a[eq+1:])
		setArgCount += countPlaceholders(expr)
		assigns = append(assigns, assign{col: col, expr: expr})
	}
	var affected int64
	for _, row := range tbl.rows {
		if wherePart != "" {
			matched, err := evalWhere(wherePart, row, args[setArgCount:])
			if err != nil {
				return 0, err
			}
			if !matched {
				continue
			}
		}
		argIdx := 0
		for _, a := range assigns {
			val, nextIdx, err := evalValueExpr(a.expr, row, args, argIdx)
			if err != nil {
				return 0, err
			}
			argIdx = nextIdx
			row[a.col] = val
		}
		affected++
	}
	return affected, nil
}

func (db *memDB) execDelete(stmt string, args []any) (int64, error) {
	rest := strings.TrimSpace(stmt[len("DELETE"):])
	if !strings.HasPrefix(strings.ToUpper(rest), "FROM ") {
		return 0, errors.New("DELETE requires FROM")
	}
	rest = strings.TrimSpace(rest[len("FROM"):])
	whereIdx := indexKeywordOutsideQuotes(rest, "WHERE")
	tblName := strings.ToLower(unquoteIdent(strings.TrimSpace(rest)))
	wherePart := ""
	if whereIdx >= 0 {
		tblName = strings.ToLower(unquoteIdent(strings.TrimSpace(rest[:whereIdx])))
		wherePart = strings.TrimSpace(rest[whereIdx+len("WHERE"):])
	}
	tbl, ok := db.tables[tblName]
	if !ok {
		return 0, fmt.Errorf("no such table: %s", tblName)
	}
	kept := make([]map[string]any, 0, len(tbl.rows))
	var deleted int64
	for _, row := range tbl.rows {
		if wherePart != "" {
			matched, err := evalWhere(wherePart, row, args)
			if err != nil {
				return 0, err
			}
			if !matched {
				kept = append(kept, row)
				continue
			}
		}
		deleted++
	}
	tbl.rows = kept
	return deleted, nil
}

func (db *memDB) query(rawSQL string, args []any) ([]string, [][]any, error) {
	stmt := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(rawSQL), ";"))
	if !strings.HasPrefix(strings.ToUpper(stmt), "SELECT ") {
		return nil, nil, fmt.Errorf("query requires SELECT, got %s", firstWord(stmt))
	}
	rest := strings.TrimSpace(stmt[len("SELECT"):])
	fromIdx := indexKeywordOutsideQuotes(rest, "FROM")
	if fromIdx < 0 {
		// 简单常量查询，如 SELECT 1
		exprs := splitTopLevelComma(rest)
		cols := make([]string, len(exprs))
		row := make([]any, len(exprs))
		argIdx := 0
		for i, e := range exprs {
			cols[i] = strings.TrimSpace(e)
			v, nextIdx, err := evalValueExpr(strings.TrimSpace(e), nil, args, argIdx)
			if err != nil {
				return nil, nil, err
			}
			argIdx = nextIdx
			row[i] = v
		}
		return cols, [][]any{row}, nil
	}
	selectList := strings.TrimSpace(rest[:fromIdx])
	afterFrom := strings.TrimSpace(rest[fromIdx+len("FROM"):])

	wherePart, orderPart, limitPart, offsetPart := "", "", "", ""
	tblClause := afterFrom
	if idx := indexKeywordOutsideQuotes(tblClause, "OFFSET"); idx >= 0 {
		offsetPart = strings.TrimSpace(tblClause[idx+len("OFFSET"):])
		tblClause = strings.TrimSpace(tblClause[:idx])
	}
	if idx := indexKeywordOutsideQuotes(tblClause, "LIMIT"); idx >= 0 {
		limitPart = strings.TrimSpace(tblClause[idx+len("LIMIT"):])
		tblClause = strings.TrimSpace(tblClause[:idx])
	}
	if idx := indexKeywordOutsideQuotes(tblClause, "ORDER BY"); idx >= 0 {
		orderPart = strings.TrimSpace(tblClause[idx+len("ORDER BY"):])
		tblClause = strings.TrimSpace(tblClause[:idx])
	}
	if idx := indexKeywordOutsideQuotes(tblClause, "WHERE"); idx >= 0 {
		wherePart = strings.TrimSpace(tblClause[idx+len("WHERE"):])
		tblClause = strings.TrimSpace(tblClause[:idx])
	}
	tblName := strings.ToLower(unquoteIdent(strings.Fields(tblClause)[0]))
	tbl, ok := db.tables[tblName]
	if !ok {
		return nil, nil, fmt.Errorf("no such table: %s", tblName)
	}
	whereArgCount := countPlaceholders(wherePart)
	var matched []map[string]any
	for _, row := range tbl.rows {
		if wherePart != "" {
			ok, err := evalWhere(wherePart, row, args[:min(whereArgCount, len(args))])
			if err != nil {
				return nil, nil, err
			}
			if !ok {
				continue
			}
		}
		matched = append(matched, row)
	}
	if orderPart != "" {
		orderItems := splitTopLevelComma(orderPart)
		sort.SliceStable(matched, func(i, j int) bool {
			for _, item := range orderItems {
				parts := strings.Fields(strings.TrimSpace(item))
				if len(parts) == 0 {
					continue
				}
				col := strings.ToLower(unquoteIdent(parts[0]))
				desc := len(parts) > 1 && strings.EqualFold(parts[1], "DESC")
				cmp := compareSQLValues(matched[i][col], matched[j][col])
				if cmp == 0 {
					continue
				}
				if desc {
					return cmp > 0
				}
				return cmp < 0
			}
			return false
		})
	}
	remArgs := args[min(whereArgCount, len(args)):]
	remIdx := 0
	limit := -1
	if limitPart != "" {
		v, next, err := evalValueExpr(limitPart, nil, remArgs, remIdx)
		if err != nil {
			return nil, nil, err
		}
		remIdx = next
		if n, ok := asInt64(v); ok {
			limit = int(n)
		}
	}
	offset := 0
	if offsetPart != "" {
		v, _, err := evalValueExpr(offsetPart, nil, remArgs, remIdx)
		if err != nil {
			return nil, nil, err
		}
		if n, ok := asInt64(v); ok && n > 0 {
			offset = int(n)
		}
	}
	// 处理 COUNT(*)
	selItems := splitTopLevelComma(selectList)
	if len(selItems) == 1 && strings.HasPrefix(strings.ToUpper(strings.TrimSpace(selItems[0])), "COUNT(") {
		colName := "count"
		if asIdx := indexKeywordOutsideQuotes(selItems[0], "AS"); asIdx >= 0 {
			colName = unquoteIdent(strings.TrimSpace(selItems[0][asIdx+2:]))
		}
		return []string{colName}, [][]any{{int64(len(matched))}}, nil
	}
	if offset > 0 {
		if offset >= len(matched) {
			matched = nil
		} else {
			matched = matched[offset:]
		}
	}
	if limit >= 0 && limit < len(matched) {
		matched = matched[:limit]
	}

	var cols []string
	var exprs []string
	for _, item := range selItems {
		item = strings.TrimSpace(item)
		if item == "*" {
			for _, c := range tbl.columns {
				cols = append(cols, c.name)
				exprs = append(exprs, c.name)
			}
			continue
		}
		alias := ""
		expr := item
		if asIdx := indexKeywordOutsideQuotes(item, "AS"); asIdx >= 0 {
			expr = strings.TrimSpace(item[:asIdx])
			alias = unquoteIdent(strings.TrimSpace(item[asIdx+2:]))
		} else {
			alias = unquoteIdent(expr)
		}
		cols = append(cols, alias)
		exprs = append(exprs, expr)
	}
	resultRows := make([][]any, 0, len(matched))
	for _, row := range matched {
		outRow := make([]any, len(exprs))
		for i, expr := range exprs {
			v, _, err := evalValueExpr(expr, row, nil, 0)
			if err != nil {
				return nil, nil, err
			}
			outRow[i] = v
		}
		resultRows = append(resultRows, outRow)
	}
	return cols, resultRows, nil
}

// ---- SQL 表达式与条件求值辅助 ----

func evalWhere(clause string, row map[string]any, args []any) (bool, error) {
	clause = strings.TrimSpace(clause)
	if clause == "" {
		return true, nil
	}
	orParts := splitTopLevelKeyword(clause, "OR")
	if len(orParts) > 1 {
		offset := 0
		for _, part := range orParts {
			n := countPlaceholders(part)
			subArgs := args[min(offset, len(args)):min(offset+n, len(args))]
			offset += n
			ok, err := evalWhere(part, row, subArgs)
			if err != nil {
				return false, err
			}
			if ok {
				return true, nil
			}
		}
		return false, nil
	}
	andParts := splitTopLevelKeyword(clause, "AND")
	if len(andParts) > 1 {
		offset := 0
		for _, part := range andParts {
			n := countPlaceholders(part)
			subArgs := args[min(offset, len(args)):min(offset+n, len(args))]
			offset += n
			ok, err := evalWhere(part, row, subArgs)
			if err != nil {
				return false, err
			}
			if !ok {
				return false, nil
			}
		}
		return true, nil
	}
	if strings.HasPrefix(clause, "(") && strings.HasSuffix(clause, ")") && matchingOuterParens(clause) {
		return evalWhere(clause[1:len(clause)-1], row, args)
	}
	up := strings.ToUpper(clause)
	if idx := strings.LastIndex(up, " IS NOT NULL"); idx > 0 {
		v, _, err := evalValueExpr(strings.TrimSpace(clause[:idx]), row, args, 0)
		return v != nil, err
	}
	if idx := strings.LastIndex(up, " IS NULL"); idx > 0 {
		v, _, err := evalValueExpr(strings.TrimSpace(clause[:idx]), row, args, 0)
		return v == nil, err
	}
	if idx := indexKeywordOutsideQuotes(clause, "LIKE"); idx > 0 {
		lhs, next, err := evalValueExpr(strings.TrimSpace(clause[:idx]), row, args, 0)
		if err != nil {
			return false, err
		}
		rhs, _, err := evalValueExpr(strings.TrimSpace(clause[idx+4:]), row, args, next)
		if err != nil {
			return false, err
		}
		return matchSQLiteLike(fmt.Sprint(lhs), fmt.Sprint(rhs)), nil
	}
	for _, op := range []string{"!=", "<>", "<=", ">=", "=", "<", ">"} {
		if idx := indexOpOutsideQuotes(clause, op); idx > 0 {
			lhs, next, err := evalValueExpr(strings.TrimSpace(clause[:idx]), row, args, 0)
			if err != nil {
				return false, err
			}
			rhs, _, err := evalValueExpr(strings.TrimSpace(clause[idx+len(op):]), row, args, next)
			if err != nil {
				return false, err
			}
			switch op {
			case "=":
				return equalSQLValues(lhs, rhs), nil
			case "!=", "<>":
				return !equalSQLValues(lhs, rhs), nil
			case "<":
				return compareSQLValues(lhs, rhs) < 0, nil
			case "<=":
				return compareSQLValues(lhs, rhs) <= 0, nil
			case ">":
				return compareSQLValues(lhs, rhs) > 0, nil
			case ">=":
				return compareSQLValues(lhs, rhs) >= 0, nil
			}
		}
	}
	return false, fmt.Errorf("unsupported WHERE clause: %s", clause)
}

func evalValueExpr(expr string, row map[string]any, args []any, argIdx int) (any, int, error) {
	expr = strings.TrimSpace(expr)
	if expr == "?" {
		if argIdx >= len(args) {
			return nil, argIdx, errors.New("not enough SQL parameters")
		}
		return args[argIdx], argIdx + 1, nil
	}
	up := strings.ToUpper(expr)
	if strings.HasPrefix(up, "COALESCE(") && strings.HasSuffix(expr, ")") {
		inner := splitTopLevelComma(expr[len("COALESCE(") : len(expr)-1])
		for _, sub := range inner {
			v, next, err := evalValueExpr(sub, row, args, argIdx)
			if err != nil {
				return nil, argIdx, err
			}
			argIdx = next
			if v != nil {
				return v, argIdx, nil
			}
		}
		return nil, argIdx, nil
	}
	if plusIdx := indexOpOutsideQuotes(expr, "+"); plusIdx > 0 {
		lhs, next, err := evalValueExpr(expr[:plusIdx], row, args, argIdx)
		if err != nil {
			return nil, argIdx, err
		}
		rhs, next2, err := evalValueExpr(expr[plusIdx+1:], row, args, next)
		if err != nil {
			return nil, next, err
		}
		li, lok := asInt64(lhs)
		ri, rok := asInt64(rhs)
		if lok && rok {
			return li + ri, next2, nil
		}
		return fmt.Sprint(lhs) + fmt.Sprint(rhs), next2, nil
	}
	if up == "NULL" {
		return nil, argIdx, nil
	}
	if strings.HasPrefix(expr, "'") && strings.HasSuffix(expr, "'") && len(expr) >= 2 {
		return strings.ReplaceAll(expr[1:len(expr)-1], "''", "'"), argIdx, nil
	}
	if iv, err := strconv.ParseInt(expr, 10, 64); err == nil {
		return iv, argIdx, nil
	}
	if fv, err := strconv.ParseFloat(expr, 64); err == nil {
		return fv, argIdx, nil
	}
	if row != nil {
		col := strings.ToLower(unquoteIdent(expr))
		if val, ok := row[col]; ok {
			return val, argIdx, nil
		}
	}
	return nil, argIdx, nil
}

func parseLiteral(tok string) any {
	tok = strings.TrimSpace(tok)
	if strings.EqualFold(tok, "NULL") {
		return nil
	}
	if strings.HasPrefix(tok, "'") && strings.HasSuffix(tok, "'") && len(tok) >= 2 {
		return strings.ReplaceAll(tok[1:len(tok)-1], "''", "'")
	}
	if iv, err := strconv.ParseInt(tok, 10, 64); err == nil {
		return iv
	}
	if fv, err := strconv.ParseFloat(tok, 64); err == nil {
		return fv
	}
	return tok
}

func asInt64(v any) (int64, bool) {
	switch x := v.(type) {
	case int64:
		return x, true
	case int:
		return int64(x), true
	case float64:
		return int64(x), true
	case bool:
		if x {
			return 1, true
		}
		return 0, true
	default:
		return 0, false
	}
}

func equalSQLValues(a, b any) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	if ai, aok := asInt64(a); aok {
		if bi, bok := asInt64(b); bok {
			return ai == bi
		}
	}
	return fmt.Sprint(a) == fmt.Sprint(b)
}

func compareSQLValues(a, b any) int {
	if a == nil && b == nil {
		return 0
	}
	if a == nil {
		return -1
	}
	if b == nil {
		return 1
	}
	if ai, aok := asInt64(a); aok {
		if bi, bok := asInt64(b); bok {
			if ai < bi {
				return -1
			}
			if ai > bi {
				return 1
			}
			return 0
		}
	}
	sa, sb := fmt.Sprint(a), fmt.Sprint(b)
	return strings.Compare(sa, sb)
}

func matchSQLiteLike(text, pattern string) bool {
	t := strings.ToLower(text)
	p := strings.ToLower(pattern)
	if strings.HasSuffix(p, "%") && !strings.ContainsAny(p[:len(p)-1], "%_") {
		return strings.HasPrefix(t, p[:len(p)-1])
	}
	if strings.HasPrefix(p, "%") && strings.HasSuffix(p, "%") && len(p) >= 2 && !strings.ContainsAny(p[1:len(p)-1], "%_") {
		return strings.Contains(t, p[1:len(p)-1])
	}
	return t == p
}

// ---- 轻量词法分割工具 ----

func firstWord(s string) string {
	fields := strings.Fields(s)
	if len(fields) == 0 {
		return ""
	}
	return strings.ToUpper(fields[0])
}

func unquoteIdent(s string) string {
	s = strings.TrimSpace(s)
	if len(s) >= 2 {
		if (s[0] == '"' && s[len(s)-1] == '"') || (s[0] == '`' && s[len(s)-1] == '`') || (s[0] == '[' && s[len(s)-1] == ']') {
			return s[1 : len(s)-1]
		}
	}
	return s
}

func splitTopLevelComma(s string) []string {
	var parts []string
	var cur strings.Builder
	depth := 0
	inSingle := false
	for i := 0; i < len(s); i++ {
		c := s[i]
		if inSingle {
			cur.WriteByte(c)
			if c == '\'' {
				if i+1 < len(s) && s[i+1] == '\'' {
					i++
					cur.WriteByte(s[i])
				} else {
					inSingle = false
				}
			}
			continue
		}
		switch c {
		case '\'':
			inSingle = true
			cur.WriteByte(c)
		case '(':
			depth++
			cur.WriteByte(c)
		case ')':
			if depth > 0 {
				depth--
			}
			cur.WriteByte(c)
		case ',':
			if depth == 0 {
				parts = append(parts, cur.String())
				cur.Reset()
			} else {
				cur.WriteByte(c)
			}
		default:
			cur.WriteByte(c)
		}
	}
	if tail := cur.String(); strings.TrimSpace(tail) != "" {
		parts = append(parts, tail)
	}
	return parts
}

func splitSQLTokens(s string) []string {
	var toks []string
	var cur strings.Builder
	inSingle := false
	flush := func() {
		if cur.Len() > 0 {
			toks = append(toks, cur.String())
			cur.Reset()
		}
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if inSingle {
			cur.WriteByte(c)
			if c == '\'' {
				if i+1 < len(s) && s[i+1] == '\'' {
					i++
					cur.WriteByte(s[i])
				} else {
					inSingle = false
					flush()
				}
			}
			continue
		}
		if c == '\'' {
			flush()
			inSingle = true
			cur.WriteByte(c)
			continue
		}
		if c == ' ' || c == '\t' || c == '\r' || c == '\n' {
			flush()
			continue
		}
		cur.WriteByte(c)
	}
	flush()
	return toks
}

func countPlaceholders(s string) int {
	n := 0
	inSingle := false
	for i := 0; i < len(s); i++ {
		c := s[i]
		if inSingle {
			if c == '\'' {
				if i+1 < len(s) && s[i+1] == '\'' {
					i++
				} else {
					inSingle = false
				}
			}
			continue
		}
		if c == '\'' {
			inSingle = true
		} else if c == '?' {
			n++
		}
	}
	return n
}

func indexKeywordOutsideQuotes(s, keyword string) int {
	up := strings.ToUpper(s)
	kw := strings.ToUpper(keyword)
	depth := 0
	inSingle := false
	for i := 0; i <= len(s)-len(kw); i++ {
		c := s[i]
		if inSingle {
			if c == '\'' {
				if i+1 < len(s) && s[i+1] == '\'' {
					i++
				} else {
					inSingle = false
				}
			}
			continue
		}
		if c == '\'' {
			inSingle = true
			continue
		}
		if c == '(' {
			depth++
			continue
		}
		if c == ')' {
			if depth > 0 {
				depth--
			}
			continue
		}
		if depth == 0 && strings.HasPrefix(up[i:], kw) {
			beforeOK := i == 0 || !isIdentChar(s[i-1])
			afterIdx := i + len(kw)
			afterOK := afterIdx == len(s) || !isIdentChar(s[afterIdx])
			if beforeOK && afterOK {
				return i
			}
		}
	}
	return -1
}

func splitTopLevelKeyword(s, keyword string) []string {
	var parts []string
	rem := s
	for {
		idx := indexKeywordOutsideQuotes(rem, keyword)
		if idx < 0 {
			parts = append(parts, strings.TrimSpace(rem))
			break
		}
		parts = append(parts, strings.TrimSpace(rem[:idx]))
		rem = rem[idx+len(keyword):]
	}
	return parts
}

func indexOpOutsideQuotes(s, op string) int {
	depth := 0
	inSingle := false
	for i := 0; i <= len(s)-len(op); i++ {
		c := s[i]
		if inSingle {
			if c == '\'' {
				if i+1 < len(s) && s[i+1] == '\'' {
					i++
				} else {
					inSingle = false
				}
			}
			continue
		}
		if c == '\'' {
			inSingle = true
			continue
		}
		if c == '(' {
			depth++
			continue
		}
		if c == ')' {
			if depth > 0 {
				depth--
			}
			continue
		}
		if depth == 0 && strings.HasPrefix(s[i:], op) {
			return i
		}
	}
	return -1
}

func matchingOuterParens(s string) bool {
	depth := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '(' {
			depth++
		} else if s[i] == ')' {
			depth--
			if depth == 0 && i < len(s)-1 {
				return false
			}
		}
	}
	return depth == 0
}

func isIdentChar(c byte) bool {
	return c == '_' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
}

func splitMigrationSQL(src string) ([]string, error) {
	var stmts []string
	var cur strings.Builder
	depth, cases := 0, 0
	flush := func() {
		if t := strings.TrimSpace(cur.String()); t != "" {
			stmts = append(stmts, t)
		}
		cur.Reset()
	}
	runes := []rune(src)
	for i := 0; i < len(runes); i++ {
		ch := runes[i]
		switch {
		case ch == '-' && i+1 < len(runes) && runes[i+1] == '-':
			for i < len(runes) && runes[i] != '\n' {
				i++
			}
			cur.WriteRune(' ')
		case ch == '/' && i+1 < len(runes) && runes[i+1] == '*':
			i += 2
			for i+1 < len(runes) && !(runes[i] == '*' && runes[i+1] == '/') {
				i++
			}
			if i+1 >= len(runes) {
				return nil, errors.New("unclosed block comment")
			}
			i++
			cur.WriteRune(' ')
		case ch == '\'' || ch == '"' || ch == '`' || ch == '[':
			closing := ch
			if ch == '[' {
				closing = ']'
			}
			cur.WriteRune(ch)
			closed := false
			for i++; i < len(runes); i++ {
				cur.WriteRune(runes[i])
				if runes[i] != closing {
					continue
				}
				if closing != ']' && i+1 < len(runes) && runes[i+1] == closing {
					i++
					cur.WriteRune(runes[i])
					continue
				}
				closed = true
				break
			}
			if !closed {
				return nil, errors.New("unclosed literal or identifier")
			}
		case ch == ';' && depth == 0:
			flush()
		default:
			if isIdentRune(ch) && (i == 0 || !isIdentRune(runes[i-1])) {
				end := i
				for end < len(runes) && isIdentRune(runes[end]) {
					end++
				}
				word := string(runes[i:end])
				cur.WriteString(word)
				head := strings.ToUpper(strings.Join(strings.Fields(cur.String()), " "))
				switch strings.ToUpper(word) {
				case "BEGIN":
					if strings.HasPrefix(head, "CREATE ") && strings.Contains(head, " TRIGGER ") {
						depth++
					}
				case "CASE":
					cases++
				case "END":
					if cases > 0 {
						cases--
					} else if depth > 0 {
						depth--
					}
				}
				i = end - 1
				continue
			}
			cur.WriteRune(ch)
		}
	}
	if depth != 0 {
		return nil, errors.New("unclosed CREATE TRIGGER BEGIN ... END")
	}
	flush()
	return stmts, nil
}

func isIdentRune(r rune) bool {
	return r == '_' || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')
}

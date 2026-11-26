package appspec

import (
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// 数据库迁移文件规则，合同见 docs/spec/02-backend.md 第 5 节。

const migrationRoot = "backend/migrations/"

var migrationNamePattern = regexp.MustCompile(`^(\d{4})_([a-z0-9][a-z0-9-]*)\.sql$`)

// MigrationDigest 是一个迁移文件的编号与摘要。
type MigrationDigest struct {
	ID     string `json:"id"`
	SHA256 string `json:"sha256"`
}

// 允许作为迁移语句开头的关键字；PRAGMA 只允许 foreign_keys。
var migrationKeywords = map[string]bool{
	"CREATE": true, "ALTER": true, "DROP": true, "INSERT": true, "UPDATE": true, "DELETE": true,
	"REPLACE": true, "WITH": true, "REINDEX": true, "PRAGMA": true,
}

// MigrationDigests 按存储范围列出包内迁移（按编号排序）。files 必须已通过校验。
func MigrationDigests(files []File) map[string][]MigrationDigest {
	result := map[string][]MigrationDigest{}
	for _, file := range files {
		rest, ok := strings.CutPrefix(file.Path, migrationRoot)
		if !ok {
			continue
		}
		scope, name, ok := strings.Cut(rest, "/")
		if !ok {
			continue
		}
		result[scope] = append(result[scope], MigrationDigest{ID: strings.TrimSuffix(name, ".sql"), SHA256: SHA256(file.Content)})
	}
	for scope := range result {
		sort.Slice(result[scope], func(i, j int) bool { return result[scope][i].ID < result[scope][j].ID })
	}
	return result
}

// CompareMigrations 检查 current 是否只在 previous 之后追加：已发布的迁移不能修改、删除或重新编号。
func CompareMigrations(previous, current map[string][]MigrationDigest) error {
	scopes := make([]string, 0, len(previous))
	for scope := range previous {
		scopes = append(scopes, scope)
	}
	sort.Strings(scopes)
	for _, scope := range scopes {
		before, after := previous[scope], current[scope]
		if len(after) < len(before) {
			return fmt.Errorf("%s 范围删除了已发布的迁移（上一版本有 %d 个，现在 %d 个）", scope, len(before), len(after))
		}
		for i, published := range before {
			if after[i].ID != published.ID {
				return fmt.Errorf("%s 范围的已发布迁移 %s 被改名或重新编号为 %s", scope, published.ID, after[i].ID)
			}
			if after[i].SHA256 != published.SHA256 {
				return fmt.Errorf("%s 范围的已发布迁移 %s 被修改；已发布的迁移只能追加，不能修改", scope, published.ID)
			}
		}
	}
	return nil
}

func validateMigrations(b *Backend, files []File) error {
	enabled := map[string]bool{}
	for _, scope := range b.StorageScopes() {
		enabled[scope] = true
	}
	numbers := map[string][]int{}
	for _, file := range files {
		rest, ok := strings.CutPrefix(file.Path, migrationRoot)
		if !ok {
			continue
		}
		scope, name, ok := strings.Cut(rest, "/")
		if !ok || strings.Contains(name, "/") {
			return fmt.Errorf("迁移文件 %q 必须位于 backend/migrations/<范围>/ 下", file.Path)
		}
		if !enabled[scope] {
			return fmt.Errorf("迁移文件 %q 所在的范围 %q 没有在 backend.storage 中启用", file.Path, scope)
		}
		match := migrationNamePattern.FindStringSubmatch(name)
		if match == nil {
			return fmt.Errorf("迁移文件名 %q 应为 NNNN_<名称>.sql（四位编号，名称为小写字母、数字或连字符）", name)
		}
		number, _ := strconv.Atoi(match[1])
		numbers[scope] = append(numbers[scope], number)
		if err := checkMigrationSQL(string(file.Content)); err != nil {
			return fmt.Errorf("迁移文件 %q：%w", file.Path, err)
		}
	}
	for scope, list := range numbers {
		sort.Ints(list)
		for i, number := range list {
			if number != i+1 {
				return fmt.Errorf("%s 范围的迁移编号必须从 0001 开始连续递增，缺少或重复 %04d", scope, i+1)
			}
		}
	}
	return nil
}

// checkMigrationSQL 拆分语句并检查每条语句的开头关键字。
func checkMigrationSQL(sql string) error {
	statements, err := splitSQL(sql)
	if err != nil {
		return err
	}
	if len(statements) == 0 {
		return errors.New("没有任何语句")
	}
	for _, statement := range statements {
		upper := strings.ToUpper(statement)
		if strings.Contains(strings.ToLower(statement), "_app_migrations") {
			return errors.New("不能读写由目标系统维护的 _app_migrations 表")
		}
		fields := strings.Fields(upper)
		keyword := fields[0]
		if !migrationKeywords[keyword] {
			return fmt.Errorf("不允许以 %s 开头的语句（不允许 ATTACH、VACUUM、事务控制等）", keyword)
		}
		if keyword == "PRAGMA" {
			name := strings.TrimSpace(strings.TrimPrefix(upper, "PRAGMA"))
			if !strings.HasPrefix(name, "FOREIGN_KEYS") {
				return errors.New("PRAGMA 只允许 foreign_keys")
			}
		}
		if strings.Contains(upper, "VACUUM") && keyword != "CREATE" {
			return errors.New("不允许 VACUUM")
		}
	}
	return nil
}

// splitSQL 按分号拆分 SQL，跳过字符串、带引号的标识符与注释；CREATE TRIGGER 的 BEGIN … END
// （其中可以有 CASE … END）作为一条语句。
func splitSQL(sql string) ([]string, error) {
	var statements []string
	var current strings.Builder
	depth, cases := 0, 0
	flush := func() {
		if statement := strings.TrimSpace(current.String()); statement != "" {
			statements = append(statements, statement)
		}
		current.Reset()
	}
	runes := []rune(sql)
	for i := 0; i < len(runes); i++ {
		char := runes[i]
		switch {
		case char == '-' && i+1 < len(runes) && runes[i+1] == '-':
			for i < len(runes) && runes[i] != '\n' {
				i++
			}
			current.WriteRune(' ')
		case char == '/' && i+1 < len(runes) && runes[i+1] == '*':
			i += 2
			for i+1 < len(runes) && !(runes[i] == '*' && runes[i+1] == '/') {
				i++
			}
			if i+1 >= len(runes) {
				return nil, errors.New("注释没有结束")
			}
			i++
			current.WriteRune(' ')
		case char == '\'' || char == '"' || char == '`' || char == '[':
			closing := char
			if char == '[' {
				closing = ']'
			}
			current.WriteRune(char)
			closed := false
			for i++; i < len(runes); i++ {
				current.WriteRune(runes[i])
				if runes[i] != closing {
					continue
				}
				if closing != ']' && i+1 < len(runes) && runes[i+1] == closing {
					i++
					current.WriteRune(runes[i])
					continue
				}
				closed = true
				break
			}
			if !closed {
				return nil, errors.New("字符串或标识符没有结束")
			}
		case char == ';' && depth == 0:
			flush()
		case isWordStart(runes, i):
			word := readWord(runes, i)
			current.WriteString(word)
			head := strings.ToUpper(strings.Join(strings.Fields(current.String()), " "))
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
			i += len([]rune(word)) - 1
		default:
			current.WriteRune(char)
		}
	}
	if depth != 0 {
		return nil, errors.New("CREATE TRIGGER 的 BEGIN 没有对应的 END")
	}
	flush()
	return statements, nil
}

func isWordStart(runes []rune, i int) bool {
	if !isWordRune(runes[i]) {
		return false
	}
	return i == 0 || !isWordRune(runes[i-1])
}

func readWord(runes []rune, i int) string {
	end := i
	for end < len(runes) && isWordRune(runes[end]) {
		end++
	}
	return string(runes[i:end])
}

func isWordRune(r rune) bool {
	return r == '_' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9'
}

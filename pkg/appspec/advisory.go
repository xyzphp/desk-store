package appspec

import (
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// 安全通告，合同见 docs/spec/03-catalog.md 第 5 节。

// 通告文件与签名文件在 api/v1/ 下的名称。
const (
	AdvisoriesFile          = "advisories.json"
	AdvisoriesSignatureFile = "advisories.json.sig"
)

var advisoryIDPattern = regexp.MustCompile(`^[A-Z]{2,8}-\d{4}-\d{4}$`)

// Advisories 是 api/v1/advisories.json。
type Advisories struct {
	Schema      int        `json:"schema"`
	GeneratedAt string     `json:"generatedAt"`
	Advisories  []Advisory `json:"advisories"`
}

// Advisory 是一条安全通告。
type Advisory struct {
	ID          string `json:"id"`
	Slug        string `json:"slug"`
	Versions    string `json:"versions"`
	Severity    string `json:"severity"`
	Title       string `json:"title"`
	Description string `json:"description"`
	FixedIn     string `json:"fixedIn,omitempty"`
	Action      string `json:"action"`
}

// Validate 校验通告字段。
func (a Advisory) Validate() error {
	if !advisoryIDPattern.MatchString(a.ID) {
		return fmt.Errorf("通告编号 %q 应为 前缀-年份-序号，例如 DS-2026-0001", a.ID)
	}
	if !ValidSlug(a.Slug) {
		return fmt.Errorf("通告 %s 的 slug 无效", a.ID)
	}
	if _, err := MatchVersionRange(a.Versions, "0.0.0"); err != nil {
		return fmt.Errorf("通告 %s 的 versions：%w", a.ID, err)
	}
	switch a.Severity {
	case "low", "medium", "high", "critical":
	default:
		return fmt.Errorf("通告 %s 的 severity 只支持 low、medium、high、critical", a.ID)
	}
	if strings.TrimSpace(a.Title) == "" || len([]rune(a.Title)) > 120 {
		return fmt.Errorf("通告 %s 的 title 必须是 1-120 个字符", a.ID)
	}
	if len([]rune(a.Description)) > 4000 {
		return fmt.Errorf("通告 %s 的 description 不能超过 4000 个字符", a.ID)
	}
	switch a.Action {
	case "update":
		if !ValidVersion(a.FixedIn) {
			return fmt.Errorf("通告 %s 的 action 为 update 时必须给出 fixedIn 版本", a.ID)
		}
		if affected, _ := MatchVersionRange(a.Versions, a.FixedIn); affected {
			return fmt.Errorf("通告 %s 的 fixedIn %s 仍在受影响范围内", a.ID, a.FixedIn)
		}
	case "disable":
		if a.FixedIn != "" && !ValidVersion(a.FixedIn) {
			return fmt.Errorf("通告 %s 的 fixedIn 无效", a.ID)
		}
	default:
		return fmt.Errorf("通告 %s 的 action 只支持 update 或 disable", a.ID)
	}
	return nil
}

// Affects 判断版本是否受该通告影响。
func (a Advisory) Affects(version string) bool {
	affected, err := MatchVersionRange(a.Versions, version)
	return err == nil && affected
}

// MatchVersionRange 判断版本是否满足范围：空格分隔的若干条件，全部满足才算命中；
// 每个条件为 <、<=、>、>=、= 加 semver 版本号。
func MatchVersionRange(expr, version string) (bool, error) {
	conditions := strings.Fields(expr)
	if len(conditions) == 0 || len(conditions) > 4 {
		return false, errors.New("版本范围必须是 1-4 个条件，例如 <1.2.3 或 >=1.0.0 <1.2.3")
	}
	matched := true
	for _, condition := range conditions {
		operator := strings.TrimRight(condition, "0123456789.-+abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ~")
		target := strings.TrimPrefix(condition, operator)
		if !ValidVersion(target) {
			return false, fmt.Errorf("条件 %q 中的版本号无效", condition)
		}
		compared := CompareVersions(version, target)
		switch operator {
		case "<":
			matched = matched && compared < 0
		case "<=":
			matched = matched && compared <= 0
		case ">":
			matched = matched && compared > 0
		case ">=":
			matched = matched && compared >= 0
		case "=":
			matched = matched && compared == 0
		default:
			return false, fmt.Errorf("条件 %q 的运算符只支持 <、<=、>、>=、=", condition)
		}
	}
	return matched, nil
}

// SignAdvisories 对通告文件的原始字节签名，返回签名文件内容：第一行 keyId:<id>，第二行为 base64 签名值。
func SignAdvisories(private ed25519.PrivateKey, data []byte) []byte {
	public := private.Public().(ed25519.PublicKey)
	value := base64.StdEncoding.EncodeToString(ed25519.Sign(private, data))
	return []byte("keyId:" + KeyID(public) + "\n" + value + "\n")
}

// VerifyAdvisories 用商店公布的公钥校验通告文件的签名。
func VerifyAdvisories(keys []PublicKey, data, signature []byte) error {
	lines := strings.Split(strings.TrimSpace(strings.ReplaceAll(string(signature), "\r\n", "\n")), "\n")
	if len(lines) != 2 || !strings.HasPrefix(lines[0], "keyId:") {
		return errors.New("通告签名文件格式无效")
	}
	keyID := strings.TrimSpace(strings.TrimPrefix(lines[0], "keyId:"))
	value, err := base64.StdEncoding.DecodeString(strings.TrimSpace(lines[1]))
	if err != nil {
		return errors.New("通告签名值无效")
	}
	for _, key := range keys {
		if key.ID != keyID {
			continue
		}
		public, err := ParsePublicKey(key)
		if err != nil {
			return err
		}
		if !ed25519.Verify(public, data, value) {
			return errors.New("通告签名校验失败")
		}
		return nil
	}
	return errors.New("通告签名使用的公钥不在商店公布的列表中")
}

package build

import (
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/xyzphp/desk-store/pkg/appspec"
)

// SignOptions 控制签名。
type SignOptions struct {
	OutDir     string
	PrivateKey string // base64 编码的 32 字节种子
	// RequireConfigured 要求签名公钥已写入 store.config.json；发布时开启，
	// 本地联调时关闭，签名公钥会追加到输出的 store.json。
	RequireConfigured bool
}

// Sign 为输出目录中所有未签名的版本签名，并校验已有签名。
func Sign(options SignOptions) (int, error) {
	private, err := appspec.ParsePrivateKey(options.PrivateKey)
	if err != nil {
		return 0, err
	}
	public := private.Public().(ed25519.PublicKey)
	apiDir := APIDir(options.OutDir)
	var info appspec.StoreInfo
	if err := readJSON(filepath.Join(apiDir, "store.json"), &info); err != nil {
		return 0, err
	}
	keyID := appspec.KeyID(public)
	configured := false
	for _, key := range info.Keys {
		if key.ID == keyID {
			configured = true
		}
	}
	if !configured {
		if options.RequireConfigured {
			return 0, fmt.Errorf("签名公钥 %s 不在 store.config.json 的 keys 中", keyID)
		}
		info.Keys = append(info.Keys, appspec.NewPublicKey(public))
		if err := writeJSON(filepath.Join(apiDir, "store.json"), info); err != nil {
			return 0, err
		}
	}
	files, err := filepath.Glob(filepath.Join(apiDir, "apps", "*.json"))
	if err != nil {
		return 0, err
	}
	signed := 0
	for _, file := range files {
		var detail appspec.AppDetail
		if err := readJSON(file, &detail); err != nil {
			return 0, err
		}
		for i := range detail.Versions {
			version := &detail.Versions[i]
			record := version.Record(info.ID, detail.Slug)
			if version.Signature == nil {
				signature := appspec.Sign(private, record)
				version.Signature = &signature
				signed++
				continue
			}
			if err := appspec.Verify(info.Keys, record, *version.Signature); err != nil {
				return 0, fmt.Errorf("%s@%s 的已有签名无效：%w", detail.Slug, version.Version, err)
			}
		}
		if err := writeJSON(file, detail); err != nil {
			return 0, err
		}
	}
	return signed, nil
}

// VerifyOutput 校验输出目录中每个版本都有有效签名，且本地存在的安装包哈希一致。
func VerifyOutput(outDir string) error {
	apiDir := APIDir(outDir)
	var info appspec.StoreInfo
	if err := readJSON(filepath.Join(apiDir, "store.json"), &info); err != nil {
		return err
	}
	files, err := filepath.Glob(filepath.Join(apiDir, "apps", "*.json"))
	if err != nil {
		return err
	}
	for _, file := range files {
		var detail appspec.AppDetail
		if err := readJSON(file, &detail); err != nil {
			return err
		}
		for _, version := range detail.Versions {
			if version.Signature == nil {
				return fmt.Errorf("%s@%s 没有签名", detail.Slug, version.Version)
			}
			if err := appspec.Verify(info.Keys, version.Record(info.ID, detail.Slug), *version.Signature); err != nil {
				return fmt.Errorf("%s@%s：%w", detail.Slug, version.Version, err)
			}
			if strings.HasPrefix(version.URL, "packages/") {
				data, err := os.ReadFile(filepath.Join(apiDir, filepath.FromSlash(version.URL)))
				if err == nil && appspec.SHA256(data) != version.SHA256 {
					return fmt.Errorf("%s@%s 的安装包哈希不一致", detail.Slug, version.Version)
				}
			}
		}
	}
	return nil
}

func readJSON(file string, target any) error {
	raw, err := os.ReadFile(file)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(raw, target); err != nil {
		return errors.New(file + " 无法解析：" + err.Error())
	}
	return nil
}

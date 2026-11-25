// Package build 把 apps/ 下的应用源码生成为商店的静态数据：安装包、索引、详情与资源。
package build

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/xyzphp/desk-store/pkg/appspec"
)

// Config 是仓库根目录 store.config.json 的内容。
type Config struct {
	ID          string              `json:"id"`
	Name        string              `json:"name"`
	Description string              `json:"description"`
	Homepage    string              `json:"homepage,omitempty"`
	Repository  string              `json:"repository,omitempty"`
	Access      string              `json:"access"`
	Keys        []appspec.PublicKey `json:"keys"`
}

// Options 控制一次构建。
type Options struct {
	AppsDir      string // 应用源码目录，默认 apps
	ConfigPath   string // 商店配置，默认 store.config.json
	OutDir       string // 输出目录；数据写入 OutDir/api/v1
	Previous     string // 已发布数据（api/v1 目录或其 URL），为空表示首次发布
	DownloadBase string // 安装包下载前缀（如 GitHub Release 下载地址）；为空时使用站内相对地址
	Now          time.Time
}

// NewVersion 是本次构建新增、需要上传与签名的版本。
type NewVersion struct {
	Slug    string `json:"slug"`
	Version string `json:"version"`
	Tag     string `json:"tag"`
	File    string `json:"file"` // 相对 OutDir 的路径
}

// Result 汇总构建结果。
type Result struct {
	Apps        int
	NewVersions []NewVersion
}

// APIDir 返回输出目录中的数据目录。
func APIDir(out string) string { return filepath.Join(out, "api", "v1") }

// Run 执行构建。
func Run(options Options) (Result, error) {
	if options.AppsDir == "" {
		options.AppsDir = "apps"
	}
	if options.ConfigPath == "" {
		options.ConfigPath = "store.config.json"
	}
	if options.Now.IsZero() {
		options.Now = time.Now().UTC()
	}
	now := options.Now.UTC().Format(time.RFC3339)
	config, err := LoadConfig(options.ConfigPath)
	if err != nil {
		return Result{}, err
	}
	previous, err := loadPrevious(options.Previous)
	if err != nil {
		return Result{}, err
	}
	apiDir := APIDir(options.OutDir)
	if err := os.RemoveAll(apiDir); err != nil {
		return Result{}, err
	}
	for _, dir := range []string{"apps", "packages", "assets"} {
		if err := os.MkdirAll(filepath.Join(apiDir, dir), 0o755); err != nil {
			return Result{}, err
		}
	}
	entries, err := os.ReadDir(options.AppsDir)
	if err != nil {
		return Result{}, err
	}
	var result Result
	index := appspec.Index{Schema: appspec.CatalogSchema, GeneratedAt: now, Apps: []appspec.IndexEntry{}}
	seen := map[string]bool{}
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		app, err := LoadApp(filepath.Join(options.AppsDir, entry.Name()))
		if err != nil {
			return Result{}, fmt.Errorf("%s：%w", entry.Name(), err)
		}
		detail, created, err := buildApp(app, previous[app.Slug()], config, options, apiDir, now)
		if err != nil {
			return Result{}, fmt.Errorf("%s：%w", app.Slug(), err)
		}
		if created != nil {
			result.NewVersions = append(result.NewVersions, *created)
		}
		seen[app.Slug()] = true
		index.Apps = append(index.Apps, indexEntry(detail, now))
		if err := writeJSON(filepath.Join(apiDir, "apps", app.Slug()+".json"), detail); err != nil {
			return Result{}, err
		}
	}
	// 从仓库删除的应用保留为“已下架”，已安装的实例仍能看到它的状态。
	for slug, detail := range previous {
		if seen[slug] {
			continue
		}
		detail.Withdrawn = true
		detail.Icon = ""
		detail.Screenshots = []string{}
		index.Apps = append(index.Apps, indexEntry(*detail, now))
		if err := writeJSON(filepath.Join(apiDir, "apps", slug+".json"), detail); err != nil {
			return Result{}, err
		}
	}
	sort.Slice(index.Apps, func(i, j int) bool { return index.Apps[i].Slug < index.Apps[j].Slug })
	result.Apps = len(index.Apps)
	if err := writeJSON(filepath.Join(apiDir, "index.json"), index); err != nil {
		return Result{}, err
	}
	info := appspec.StoreInfo{
		Schema: appspec.CatalogSchema, ID: config.ID, Name: config.Name, Description: config.Description,
		Homepage: config.Homepage, Access: config.Access, Formats: []int{1}, Keys: config.Keys,
	}
	if info.Keys == nil {
		info.Keys = []appspec.PublicKey{}
	}
	if err := writeJSON(filepath.Join(apiDir, "store.json"), info); err != nil {
		return Result{}, err
	}
	if result.NewVersions == nil {
		result.NewVersions = []NewVersion{}
	}
	return result, writeJSON(filepath.Join(options.OutDir, "new-versions.json"), result.NewVersions)
}

func buildApp(app *App, prior *appspec.AppDetail, config Config, options Options, apiDir, now string) (appspec.AppDetail, *NewVersion, error) {
	slug, manifest := app.Slug(), app.Package.Manifest
	zipData, err := app.Package.Pack()
	if err != nil {
		return appspec.AppDetail{}, nil, err
	}
	sum := appspec.SHA256(zipData)
	assetDir := filepath.Join(apiDir, "assets", slug)
	if err := os.MkdirAll(filepath.Join(assetDir, "screenshots"), 0o755); err != nil {
		return appspec.AppDetail{}, nil, err
	}
	icon, _ := app.Package.File(manifest.Icon)
	if err := os.WriteFile(filepath.Join(assetDir, manifest.Icon), icon.Content, 0o644); err != nil {
		return appspec.AppDetail{}, nil, err
	}
	screenshots := []string{}
	for _, name := range app.Meta.Screenshots {
		if err := os.WriteFile(filepath.Join(assetDir, "screenshots", name), app.Screenshots[name], 0o644); err != nil {
			return appspec.AppDetail{}, nil, err
		}
		screenshots = append(screenshots, path.Join("assets", slug, "screenshots", name))
	}
	fileName := slug + "-" + manifest.Version + ".zip"
	if err := os.WriteFile(filepath.Join(apiDir, "packages", fileName), zipData, 0o644); err != nil {
		return appspec.AppDetail{}, nil, err
	}
	var versions []appspec.Version
	if prior != nil {
		versions = append(versions, prior.Versions...)
	}
	var created *NewVersion
	found := false
	for i := range versions {
		if versions[i].Version != manifest.Version {
			continue
		}
		found = true
		if versions[i].SHA256 != sum {
			return appspec.AppDetail{}, nil, fmt.Errorf("版本 %s 已发布，但安装包内容已改变：修改应用后必须提升 version", manifest.Version)
		}
	}
	if !found {
		for _, version := range versions {
			if appspec.CompareVersions(manifest.Version, version.Version) <= 0 {
				return appspec.AppDetail{}, nil, fmt.Errorf("新版本 %s 必须高于已发布的 %s", manifest.Version, version.Version)
			}
		}
		tag := slug + "@" + manifest.Version
		downloadURL := path.Join("packages", fileName)
		if options.DownloadBase != "" {
			downloadURL = strings.TrimRight(options.DownloadBase, "/") + "/" + url.PathEscape(tag) + "/" + fileName
		}
		versions = append(versions, appspec.Version{
			Version: manifest.Version, Format: manifest.Format, SHA256: sum, Size: len(zipData), URL: downloadURL,
			PublishedAt: now, Changelog: app.Changelog(manifest.Version), Permissions: manifest.Summarize(),
		})
		created = &NewVersion{Slug: slug, Version: manifest.Version, Tag: tag, File: filepath.ToSlash(filepath.Join("api", "v1", "packages", fileName))}
	}
	latest := ""
	for i := range versions {
		versions[i].Yanked = app.Meta.IsYanked(versions[i].Version)
		if !versions[i].Yanked && (latest == "" || appspec.CompareVersions(versions[i].Version, latest) > 0) {
			latest = versions[i].Version
		}
	}
	sort.Slice(versions, func(i, j int) bool { return appspec.CompareVersions(versions[i].Version, versions[j].Version) > 0 })
	tags := app.Meta.Tags
	if tags == nil {
		tags = []string{}
	}
	source := ""
	if config.Repository != "" {
		source = strings.TrimRight(config.Repository, "/") + "/tree/main/apps/" + slug
	}
	return appspec.AppDetail{
		Schema: appspec.CatalogSchema, Slug: slug, Name: manifest.Name, Summary: app.Meta.Summary,
		Description: app.Description(), Category: app.Meta.Category, Tags: tags, Authors: app.Meta.Authors,
		License: app.Meta.License, Homepage: app.Meta.Homepage, Repository: app.Meta.Repository, Source: source,
		Pricing: app.Meta.Pricing, PricingURL: app.Meta.PricingURL,
		Icon: path.Join("assets", slug, manifest.Icon), Screenshots: screenshots,
		Withdrawn: app.Meta.Withdrawn, LatestVersion: latest, Versions: versions,
	}, created, nil
}

func indexEntry(detail appspec.AppDetail, now string) appspec.IndexEntry {
	capabilities := []string{}
	updatedAt := now
	for _, version := range detail.Versions {
		if version.Version == detail.LatestVersion {
			capabilities = version.Permissions.Capabilities
			updatedAt = version.PublishedAt
		}
	}
	return appspec.IndexEntry{
		Slug: detail.Slug, Name: detail.Name, Summary: detail.Summary, Category: detail.Category, Tags: detail.Tags,
		Icon: detail.Icon, LatestVersion: detail.LatestVersion, Pricing: detail.Pricing,
		Capabilities: capabilities, Withdrawn: detail.Withdrawn, UpdatedAt: updatedAt,
	}
}

// LoadConfig 读取并校验商店配置。
func LoadConfig(file string) (Config, error) {
	var config Config
	raw, err := os.ReadFile(file)
	if err != nil {
		return config, err
	}
	if err := strictJSON(raw, &config); err != nil {
		return config, fmt.Errorf("%s 无法解析：%w", file, err)
	}
	if !appspec.ValidSlug(config.ID) || strings.TrimSpace(config.Name) == "" {
		return config, errors.New("store.config.json 需要有效的 id 与 name")
	}
	if config.Access == "" {
		config.Access = "public"
	}
	if config.Access != "public" && config.Access != "token" {
		return config, errors.New("store.config.json 的 access 只能是 public 或 token")
	}
	for _, key := range config.Keys {
		if _, err := appspec.ParsePublicKey(key); err != nil {
			return config, fmt.Errorf("store.config.json 的公钥 %s：%w", key.ID, err)
		}
	}
	return config, nil
}

// loadPrevious 读取已发布的详情；source 可以是 api/v1 目录或其 URL。
func loadPrevious(source string) (map[string]*appspec.AppDetail, error) {
	details := map[string]*appspec.AppDetail{}
	if source == "" {
		return details, nil
	}
	read := func(name string) ([]byte, error) {
		if strings.HasPrefix(source, "https://") || strings.HasPrefix(source, "http://") {
			return fetch(strings.TrimRight(source, "/") + "/" + name)
		}
		data, err := os.ReadFile(filepath.Join(source, filepath.FromSlash(name)))
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return data, err
	}
	raw, err := read("index.json")
	if err != nil || raw == nil {
		return details, err
	}
	var index appspec.Index
	if err := json.Unmarshal(raw, &index); err != nil {
		return nil, fmt.Errorf("已发布的 index.json 无法解析：%w", err)
	}
	for _, entry := range index.Apps {
		if !appspec.ValidSlug(entry.Slug) {
			continue
		}
		raw, err := read("apps/" + entry.Slug + ".json")
		if err != nil {
			return nil, err
		}
		if raw == nil {
			return nil, fmt.Errorf("已发布数据缺少 apps/%s.json", entry.Slug)
		}
		detail := &appspec.AppDetail{}
		if err := json.Unmarshal(raw, detail); err != nil {
			return nil, fmt.Errorf("已发布的 %s 详情无法解析：%w", entry.Slug, err)
		}
		details[entry.Slug] = detail
	}
	return details, nil
}

// fetch 读取远端文件；404 视为首次发布返回 nil。
func fetch(target string) ([]byte, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	response, err := client.Get(target)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("读取 %s 失败：HTTP %d", target, response.StatusCode)
	}
	return io.ReadAll(io.LimitReader(response.Body, 8<<20))
}

func strictJSON(raw []byte, target any) error {
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	return decoder.Decode(target)
}

func writeJSON(file string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return err
	}
	return os.WriteFile(file, append(data, '\n'), 0o644)
}

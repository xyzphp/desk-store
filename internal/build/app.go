package build

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/xyzphp/desk-store/pkg/appspec"
)

// 应用目录允许出现的顶层条目。src/ 存放需要构建的源码（不进入安装包），
// LICENSE 用于应用自带的许可证全文。
var appDirEntries = map[string]bool{
	"package": true, "store.json": true, "README.md": true, "CHANGELOG.md": true,
	"screenshots": true, "src": true, "LICENSE": true,
}

// App 是 apps/<slug>/ 目录的内容。
type App struct {
	Dir         string
	Package     *appspec.Package
	Meta        appspec.Meta
	Readme      string
	ChangeLog   string
	Screenshots map[string][]byte
}

// Slug 返回应用标识。
func (a *App) Slug() string { return a.Package.Manifest.Slug }

// LoadApp 读取并校验一个应用目录。
func LoadApp(dir string) (*App, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		if !appDirEntries[entry.Name()] {
			return nil, fmt.Errorf("应用目录中不允许出现 %q（允许：package/、store.json、README.md、CHANGELOG.md、screenshots/、src/、LICENSE）", entry.Name())
		}
	}
	pkg, err := appspec.ParseDir(filepath.Join(dir, "package"))
	if err != nil {
		return nil, fmt.Errorf("package/：%w", err)
	}
	if name := filepath.Base(dir); pkg.Manifest.Slug != name {
		return nil, fmt.Errorf("目录名 %q 必须与 manifest 的 slug %q 一致", name, pkg.Manifest.Slug)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "store.json"))
	if err != nil {
		return nil, errors.New("缺少 store.json")
	}
	meta, err := appspec.ParseMeta(raw)
	if err != nil {
		return nil, err
	}
	app := &App{Dir: dir, Package: pkg, Meta: meta, Screenshots: map[string][]byte{}}
	if readme, err := os.ReadFile(filepath.Join(dir, "README.md")); err == nil {
		if len(readme) > 64<<10 {
			return nil, errors.New("README.md 超过 64 KB")
		}
		app.Readme = string(readme)
	}
	if changelog, err := os.ReadFile(filepath.Join(dir, "CHANGELOG.md")); err == nil {
		app.ChangeLog = string(changelog)
	}
	for _, name := range meta.Screenshots {
		file := filepath.Join(dir, "screenshots", name)
		info, err := os.Lstat(file)
		if err != nil || !info.Mode().IsRegular() {
			return nil, fmt.Errorf("截图 %q 不存在或不是普通文件", name)
		}
		if info.Size() > appspec.MaxScreenshotSize {
			return nil, fmt.Errorf("截图 %q 超过 512 KB", name)
		}
		content, err := os.ReadFile(file)
		if err != nil {
			return nil, err
		}
		app.Screenshots[name] = content
	}
	return app, nil
}

// Description 返回详情页的 Markdown 介绍：README 去掉首个一级标题；没有 README 时使用清单描述。
func (a *App) Description() string {
	text := strings.TrimSpace(strings.ReplaceAll(a.Readme, "\r\n", "\n"))
	if strings.HasPrefix(text, "# ") {
		if _, rest, found := strings.Cut(text, "\n"); found {
			text = strings.TrimSpace(rest)
		} else {
			text = ""
		}
	}
	if text == "" {
		return a.Package.Manifest.Description
	}
	return text
}

// Changelog 返回 CHANGELOG.md 中 `## <version>` 小节的正文。
func (a *App) Changelog(version string) string {
	lines := strings.Split(strings.ReplaceAll(a.ChangeLog, "\r\n", "\n"), "\n")
	var section []string
	inside := false
	for _, line := range lines {
		if strings.HasPrefix(line, "## ") {
			heading := strings.TrimSpace(strings.TrimPrefix(line, "## "))
			heading = strings.TrimPrefix(heading, "v")
			if inside {
				break
			}
			inside = heading == version || strings.HasPrefix(heading, version+" ")
			continue
		}
		if inside {
			section = append(section, line)
		}
	}
	text := strings.TrimSpace(strings.Join(section, "\n"))
	if len(text) > 4000 {
		text = text[:4000]
	}
	return text
}

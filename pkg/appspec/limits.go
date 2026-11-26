package appspec

import (
	"fmt"
	"path"
	"strings"
)

// FormatLimits 是某个安装包格式的体积、数量与文件类型限制。
type FormatLimits struct {
	PackageSize    int             // 解压后总量（含 manifest.json）
	CompressedSize int             // ZIP 本体
	SingleFile     int             // 单文件，后端模块除外
	ModuleSize     int             // backend/app.wasm（仅格式 2）
	FileCount      int             // 文件数，含 manifest.json
	EntryCount     int             // ZIP 条目数（含目录）
	Extensions     map[string]bool // 允许的扩展名
}

// BackendModulePath 是格式 2 后端模块在包内的固定位置。
const BackendModulePath = "backend/app.wasm"

var formatOneExtensions = map[string]bool{
	".html": true, ".css": true, ".js": true, ".json": true, ".svg": true, ".png": true,
	".jpg": true, ".jpeg": true, ".webp": true, ".woff2": true, ".txt": true,
}

var formatTwoExtensions = func() map[string]bool {
	extensions := map[string]bool{".md": true, ".sql": true, ".wasm": true, ".map": true}
	for extension := range formatOneExtensions {
		extensions[extension] = true
	}
	return extensions
}()

var formatLimits = map[int]FormatLimits{
	1: {PackageSize: 1 << 20, CompressedSize: 2 << 20, SingleFile: 1 << 20, FileCount: 32, EntryCount: 64, Extensions: formatOneExtensions},
	2: {
		PackageSize: 16 << 20, CompressedSize: 18 << 20, SingleFile: 2 << 20, ModuleSize: 8 << 20,
		FileCount: 500, EntryCount: 1000, Extensions: formatTwoExtensions,
	},
}

// collectLimits 是解析清单之前读取文件时使用的上限（各格式中最宽的一档），
// 读完清单后再按实际格式收紧。
var collectLimits = formatLimits[2]

// LimitsFor 返回指定格式的限制。
func LimitsFor(format int) (FormatLimits, bool) {
	limits, ok := formatLimits[format]
	return limits, ok
}

// checkFormatLimits 按清单声明的格式检查包内文件；manifestSize 计入总量与文件数。
func checkFormatLimits(format int, manifestSize int, files []File) error {
	limits, ok := LimitsFor(format)
	if !ok {
		return fmt.Errorf("不支持的安装包格式 %d", format)
	}
	if len(files)+1 > limits.FileCount {
		return fmt.Errorf("安装包文件过多（格式 %d 上限 %d，含 manifest.json）", format, limits.FileCount)
	}
	total := manifestSize
	for _, file := range files {
		extension := strings.ToLower(path.Ext(file.Path))
		if !limits.Extensions[extension] {
			return fmt.Errorf("安装包内的 %q 在格式 %d 中不允许（文件类型 %s）", file.Path, format, extension)
		}
		limit := limits.SingleFile
		if format == 2 && file.Path == BackendModulePath {
			limit = limits.ModuleSize
		}
		if len(file.Content) > limit {
			return fmt.Errorf("安装包内的 %q 超过单文件大小限制（%s）", file.Path, formatSize(limit))
		}
		if format == 2 {
			if err := checkFormatTwoPlacement(file.Path, extension); err != nil {
				return err
			}
		}
		total += len(file.Content)
	}
	if total > limits.PackageSize {
		return fmt.Errorf("安装包解压后超过大小限制（%s）", formatSize(limits.PackageSize))
	}
	return nil
}

// checkFormatTwoPlacement 限制格式 2 新增文件类型的位置：模块、迁移、技能与提示模板各在固定目录。
func checkFormatTwoPlacement(name, extension string) error {
	switch extension {
	case ".wasm":
		if name != BackendModulePath {
			return fmt.Errorf("后端模块只能位于 %s，%q 不允许", BackendModulePath, name)
		}
	case ".sql":
		if !strings.HasPrefix(name, "backend/migrations/") {
			return fmt.Errorf("SQL 文件只能位于 backend/migrations/，%q 不允许", name)
		}
	case ".md":
		if !strings.HasPrefix(name, "skills/") && !strings.HasPrefix(name, "mcp/prompts/") {
			return fmt.Errorf("Markdown 文件只能位于 skills/ 或 mcp/prompts/，%q 不允许", name)
		}
	}
	if strings.HasPrefix(name, "skills/") {
		switch extension {
		case ".md", ".txt", ".json":
		default:
			return fmt.Errorf("技能目录只允许 .md、.txt、.json 文件，%q 不允许", name)
		}
	}
	if strings.HasPrefix(name, "backend/") && name != BackendModulePath && !strings.HasPrefix(name, "backend/migrations/") {
		return fmt.Errorf("backend/ 下只允许 %s 与 migrations/，%q 不允许", BackendModulePath, name)
	}
	return nil
}

func formatSize(bytes int) string {
	if bytes >= 1<<20 && bytes%(1<<20) == 0 {
		return fmt.Sprintf("%d MB", bytes>>20)
	}
	return fmt.Sprintf("%d KB", bytes>>10)
}

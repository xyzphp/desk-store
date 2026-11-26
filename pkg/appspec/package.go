package appspec

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// File 是包内除 manifest.json 以外的一个文件。
type File struct {
	Path    string
	Content []byte
}

// Package 是解析并校验过的安装包。
type Package struct {
	Manifest    Manifest
	ManifestRaw []byte
	Files       []File
	TotalSize   int
}

// ParseZip 解析 ZIP 安装包，并按与目标系统一致的规则校验。
func ParseZip(data []byte) (*Package, error) {
	if len(data) == 0 {
		return nil, errors.New("安装包内容为空")
	}
	if len(data) > collectLimits.CompressedSize {
		return nil, fmt.Errorf("安装包超过大小限制（压缩后 %s）", formatSize(collectLimits.CompressedSize))
	}
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, errors.New("安装包不是有效的 ZIP 文件")
	}
	if len(reader.File) > collectLimits.EntryCount {
		return nil, fmt.Errorf("安装包条目过多（上限 %d）", collectLimits.EntryCount)
	}
	collector := newCollector()
	for _, entry := range reader.File {
		if entry.FileInfo().IsDir() {
			continue
		}
		content, err := readZipEntry(entry)
		if err != nil {
			return nil, err
		}
		if err := collector.add(entry.Name, content); err != nil {
			return nil, err
		}
	}
	return collector.finish()
}

// ParseDir 把一个目录当作安装包内容解析。以 . 开头的文件和目录（如 .DS_Store）被忽略，
// 打包时同样不会包含它们；符号链接一律拒绝。
func ParseDir(dir string) (*Package, error) {
	collector := newCollector()
	err := filepath.WalkDir(dir, func(current string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if current == dir {
			return nil
		}
		if strings.HasPrefix(entry.Name(), ".") {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.Type()&fs.ModeSymlink != 0 {
			return fmt.Errorf("安装包目录中不允许符号链接：%s", entry.Name())
		}
		if entry.IsDir() {
			return nil
		}
		relative, err := filepath.Rel(dir, current)
		if err != nil {
			return err
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Size() > int64(collectLimits.ModuleSize) {
			return fmt.Errorf("安装包内的 %q 超过单文件大小限制（%s）", filepath.ToSlash(relative), formatSize(collectLimits.ModuleSize))
		}
		content, err := os.ReadFile(current)
		if err != nil {
			return err
		}
		return collector.add(filepath.ToSlash(relative), content)
	})
	if err != nil {
		return nil, err
	}
	return collector.finish()
}

type collector struct {
	pkg  *Package
	seen map[string]bool
}

func newCollector() *collector {
	return &collector{pkg: &Package{}, seen: map[string]bool{}}
}

func (c *collector) add(name string, content []byte) error {
	if len(c.pkg.Files)+2 > collectLimits.FileCount {
		return fmt.Errorf("安装包文件过多（上限 %d，含 manifest.json）", collectLimits.FileCount)
	}
	if strings.ContainsRune(name, '\\') || strings.HasPrefix(name, "/") {
		return fmt.Errorf("安装包内存在不安全的文件路径 %q", name)
	}
	clean := path.Clean(name)
	if clean != name || clean == "." || strings.HasPrefix(clean, "../") {
		return fmt.Errorf("安装包内存在不安全的文件路径 %q", name)
	}
	if c.seen[clean] {
		return fmt.Errorf("安装包内存在重复文件 %q", clean)
	}
	c.seen[clean] = true
	if !collectLimits.Extensions[strings.ToLower(path.Ext(clean))] {
		return fmt.Errorf("安装包内存在不允许的文件类型 %q", clean)
	}
	if len(content) > collectLimits.ModuleSize {
		return fmt.Errorf("安装包内的 %q 超过单文件大小限制（%s）", clean, formatSize(collectLimits.ModuleSize))
	}
	c.pkg.TotalSize += len(content)
	if c.pkg.TotalSize > collectLimits.PackageSize {
		return fmt.Errorf("安装包解压后超过大小限制（%s）", formatSize(collectLimits.PackageSize))
	}
	if clean == "manifest.json" {
		c.pkg.ManifestRaw = content
		return nil
	}
	c.pkg.Files = append(c.pkg.Files, File{Path: clean, Content: content})
	return nil
}

func (c *collector) finish() (*Package, error) {
	sort.Slice(c.pkg.Files, func(i, j int) bool { return c.pkg.Files[i].Path < c.pkg.Files[j].Path })
	manifest, err := ParseManifest(c.pkg.ManifestRaw, c.pkg.Files)
	if err != nil {
		return nil, err
	}
	c.pkg.Manifest = manifest
	return c.pkg, nil
}

func readZipEntry(entry *zip.File) ([]byte, error) {
	file, err := entry.Open()
	if err != nil {
		return nil, fmt.Errorf("无法读取安装包内的 %q", entry.Name)
	}
	defer file.Close()
	content, err := io.ReadAll(io.LimitReader(file, int64(collectLimits.ModuleSize)+1))
	if err != nil {
		return nil, fmt.Errorf("无法读取安装包内的 %q", entry.Name)
	}
	if len(content) > collectLimits.ModuleSize {
		return nil, fmt.Errorf("安装包内的 %q 超过单文件大小限制（%s）", entry.Name, formatSize(collectLimits.ModuleSize))
	}
	return content, nil
}

// zipEpoch 是 ZIP 可表示的最早时间，所有条目使用它，保证打包结果与构建时间无关。
var zipEpoch = time.Date(1980, 1, 1, 0, 0, 0, 0, time.UTC)

// Pack 把包确定性地打成 ZIP：按路径排序、固定时间戳与权限、不压缩（存储模式不受
// 压缩库版本影响）。同一份内容在任何机器上都得到字节相同的结果。
func (p *Package) Pack() ([]byte, error) {
	entries := make([]File, 0, len(p.Files)+1)
	entries = append(entries, File{Path: "manifest.json", Content: p.ManifestRaw})
	entries = append(entries, p.Files...)
	sort.Slice(entries, func(i, j int) bool { return entries[i].Path < entries[j].Path })
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for _, entry := range entries {
		header := &zip.FileHeader{Name: entry.Path, Method: zip.Store, Modified: zipEpoch}
		header.SetMode(0o644)
		target, err := writer.CreateHeader(header)
		if err != nil {
			return nil, err
		}
		if _, err := target.Write(entry.Content); err != nil {
			return nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	limits, ok := LimitsFor(p.Manifest.Format)
	if !ok {
		limits = formatLimits[1]
	}
	if buffer.Len() > limits.CompressedSize {
		return nil, fmt.Errorf("打包结果超过 %s", formatSize(limits.CompressedSize))
	}
	return buffer.Bytes(), nil
}

// File 返回包内指定路径的文件。
func (p *Package) File(name string) (File, bool) {
	for _, file := range p.Files {
		if file.Path == name {
			return file, true
		}
	}
	return File{}, false
}

// SHA256 返回十六进制小写摘要。
func SHA256(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

package build

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/xyzphp/desk-store/pkg/appspec"
)

// 从源码构建应用包，合同见 docs/spec/01-package-v2.md 第 7 节。

// BuildSpec 是 apps/<slug>/build.json。
type BuildSpec struct {
	UI      *UIBuild      `json:"ui,omitempty"`
	Backend *BackendBuild `json:"backend,omitempty"`
}

// UIBuild 声明界面源码（src/）的构建方式。
type UIBuild struct {
	Toolchain string `json:"toolchain"`
	Command   string `json:"command"`
	Output    string `json:"output"`
}

// BackendBuild 声明后端源码（backend/，独立的 Go 模块）的构建方式。
type BackendBuild struct {
	Toolchain string `json:"toolchain"`
	ABI       int    `json:"abi"`
}

// 商店登记的固定工具链：界面为 Node 主版本，后端为 Go 版本前缀。
var (
	uiToolchains      = map[string]int{"node@22": 22}
	backendToolchains = map[string]string{"go@1.26": "go1.26"}
	buildCommand      = regexp.MustCompile(`^[a-z][a-z0-9:-]{0,31}$`)
)

const buildTimeout = 10 * time.Minute

// loadBuildSpec 读取并校验 build.json；没有 build.json 时返回 nil。
func loadBuildSpec(dir string) (*BuildSpec, error) {
	raw, err := os.ReadFile(filepath.Join(dir, "build.json"))
	if errors.Is(err, os.ErrNotExist) {
		for _, source := range []string{"src", "backend"} {
			if info, err := os.Stat(filepath.Join(dir, source)); err == nil && info.IsDir() {
				return nil, fmt.Errorf("有 %s/ 源码目录时必须提供 build.json", source)
			}
		}
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var spec BuildSpec
	if err := strictJSON(raw, &spec); err != nil {
		return nil, fmt.Errorf("build.json 无法解析：%w", err)
	}
	if spec.UI == nil && spec.Backend == nil {
		return nil, errors.New("build.json 至少要声明 ui 或 backend")
	}
	if ui := spec.UI; ui != nil {
		if _, ok := uiToolchains[ui.Toolchain]; !ok {
			return nil, fmt.Errorf("build.json 的 ui.toolchain %q 不在商店登记的工具链中", ui.Toolchain)
		}
		if !buildCommand.MatchString(ui.Command) {
			return nil, errors.New("build.json 的 ui.command 必须是 package.json 中的脚本名")
		}
		if clean := path.Clean(ui.Output); ui.Output == "" || clean != ui.Output || strings.HasPrefix(clean, "..") || path.IsAbs(clean) {
			return nil, errors.New("build.json 的 ui.output 必须是 src/ 下的相对目录")
		}
		if _, err := os.Stat(filepath.Join(dir, "src", "pnpm-lock.yaml")); err != nil {
			return nil, errors.New("界面源码 src/ 必须提交 pnpm-lock.yaml")
		}
	}
	if backend := spec.Backend; backend != nil {
		if _, ok := backendToolchains[backend.Toolchain]; !ok {
			return nil, fmt.Errorf("build.json 的 backend.toolchain %q 不在商店登记的工具链中", backend.Toolchain)
		}
		if backend.ABI != 1 {
			return nil, errors.New("build.json 的 backend.abi 只支持 1")
		}
		if _, err := os.Stat(filepath.Join(dir, "backend", "go.mod")); err != nil {
			return nil, errors.New("后端源码 backend/ 必须是独立的 Go 模块（含 go.mod）")
		}
	}
	return &spec, nil
}

// checkNoPrebuilt 拒绝提交到仓库的构建产物：后端模块只能由 CI 构建。
func checkNoPrebuilt(packageDir string) error {
	return filepath.WalkDir(packageDir, func(current string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.IsDir() && strings.EqualFold(filepath.Ext(entry.Name()), ".wasm") {
			relative, _ := filepath.Rel(packageDir, current)
			return fmt.Errorf("package/%s 是预编译文件；后端模块必须由 CI 从 backend/ 源码构建", filepath.ToSlash(relative))
		}
		return nil
	})
}

// stagePackage 把 package/ 与构建产物合并到临时目录，返回该目录与清理函数。
func stagePackage(dir string, spec *BuildSpec) (string, func(), error) {
	stage, err := os.MkdirTemp("", "desk-store-stage-")
	if err != nil {
		return "", nil, err
	}
	cleanup := func() { os.RemoveAll(stage) }
	fail := func(err error) (string, func(), error) {
		cleanup()
		return "", nil, err
	}
	if err := copyTree(filepath.Join(dir, "package"), stage, false); err != nil {
		return fail(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), buildTimeout)
	defer cancel()
	if ui := spec.UI; ui != nil {
		if err := checkNodeToolchain(ctx, uiToolchains[ui.Toolchain]); err != nil {
			return fail(err)
		}
		source := filepath.Join(dir, "src")
		if err := run(ctx, source, nil, "pnpm", "install", "--frozen-lockfile", "--ignore-workspace"); err != nil {
			return fail(fmt.Errorf("安装界面依赖失败：%w", err))
		}
		if err := run(ctx, source, nil, "pnpm", "run", ui.Command); err != nil {
			return fail(fmt.Errorf("构建界面失败：%w", err))
		}
		if err := copyTree(filepath.Join(source, filepath.FromSlash(ui.Output)), stage, true); err != nil {
			return fail(fmt.Errorf("合并界面构建产物：%w", err))
		}
	}
	if backend := spec.Backend; backend != nil {
		if err := checkGoToolchain(ctx, backendToolchains[backend.Toolchain]); err != nil {
			return fail(err)
		}
		target := filepath.Join(stage, filepath.FromSlash(appspec.BackendModulePath))
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return fail(err)
		}
		env := []string{"GOOS=wasip1", "GOARCH=wasm", "CGO_ENABLED=0", "GOFLAGS=-mod=readonly"}
		if err := run(ctx, filepath.Join(dir, "backend"), env, "go", "build", "-buildmode=c-shared", "-trimpath", "-buildvcs=false", "-ldflags=-buildid=", "-o", target, "."); err != nil {
			return fail(fmt.Errorf("构建后端模块失败：%w", err))
		}
	}
	return stage, cleanup, nil
}

// copyTree 复制目录；refuseExisting 为 true 时目标已存在同名文件即报错（构建产物不能覆盖 package/ 中的文件）。
func copyTree(source, target string, refuseExisting bool) error {
	return filepath.WalkDir(source, func(current string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(source, current)
		if err != nil {
			return err
		}
		if strings.HasPrefix(entry.Name(), ".") && relative != "." {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.Type()&fs.ModeSymlink != 0 {
			return fmt.Errorf("不允许符号链接：%s", filepath.ToSlash(relative))
		}
		destination := filepath.Join(target, relative)
		if entry.IsDir() {
			return os.MkdirAll(destination, 0o755)
		}
		if refuseExisting {
			if _, err := os.Stat(destination); err == nil {
				return fmt.Errorf("构建产物 %s 与 package/ 中的文件重名", filepath.ToSlash(relative))
			}
		}
		content, err := os.ReadFile(current)
		if err != nil {
			return err
		}
		return os.WriteFile(destination, content, 0o644)
	})
}

func run(ctx context.Context, dir string, env []string, name string, args ...string) error {
	command := exec.CommandContext(ctx, name, args...)
	command.Dir = dir
	command.Env = append(os.Environ(), env...)
	output, err := command.CombinedOutput()
	if err != nil {
		text := strings.TrimSpace(string(output))
		if len(text) > 4000 {
			text = text[len(text)-4000:]
		}
		return fmt.Errorf("%s %s：%w\n%s", name, strings.Join(args, " "), err, text)
	}
	return nil
}

// toolchainMismatch 在 CI 中把工具链不一致当作错误，本地只提示。
func toolchainMismatch(message string) error {
	if os.Getenv("CI") != "" {
		return errors.New(message)
	}
	fmt.Fprintln(os.Stderr, "提示："+message+"（本地构建继续，CI 中会失败）")
	return nil
}

func checkNodeToolchain(ctx context.Context, major int) error {
	output, err := exec.CommandContext(ctx, "node", "--version").Output()
	if err != nil {
		return errors.New("构建界面需要 Node 与 pnpm")
	}
	version := strings.TrimPrefix(strings.TrimSpace(string(output)), "v")
	actual, _ := strconv.Atoi(strings.SplitN(version, ".", 2)[0])
	if actual != major {
		return toolchainMismatch(fmt.Sprintf("界面工具链要求 Node %d，当前为 %s", major, version))
	}
	return nil
}

func checkGoToolchain(ctx context.Context, prefix string) error {
	output, err := exec.CommandContext(ctx, "go", "env", "GOVERSION").Output()
	if err != nil {
		return errors.New("构建后端需要 Go")
	}
	version := strings.TrimSpace(string(output))
	if version != prefix && !strings.HasPrefix(version, prefix+".") {
		return toolchainMismatch(fmt.Sprintf("后端工具链要求 %s，当前为 %s", prefix, version))
	}
	return nil
}

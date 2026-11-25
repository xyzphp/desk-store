// appcheck 校验、打包并发布商店应用。
//
//	appcheck check [目录或 ZIP ...]   校验应用目录（默认 apps/ 下全部）
//	appcheck pack <应用目录> [-o 文件]  确定性打包为 ZIP
//	appcheck summary <应用目录> [-base 已发布数据]  输出评审用的权限摘要（Markdown）
//	appcheck build [-out dist/public] [-previous 地址] [-download-base 地址]
//	appcheck sign [-out dist/public] [-require-configured]   私钥取自 DESK_STORE_SIGNING_KEY
//	appcheck verify [-out dist/public]
//	appcheck keygen
package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/xyzphp/desk-store/internal/build"
	"github.com/xyzphp/desk-store/pkg/appspec"
)

const signingKeyEnv = "DESK_STORE_SIGNING_KEY"

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "check":
		err = check(os.Args[2:])
	case "pack":
		err = pack(os.Args[2:])
	case "summary":
		err = summary(os.Args[2:])
	case "build":
		err = runBuild(os.Args[2:])
	case "sign":
		err = sign(os.Args[2:])
	case "verify":
		err = verify(os.Args[2:])
	case "keygen":
		err = keygen()
	case "help", "-h", "--help":
		usage()
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "错误：", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, `用法：appcheck <命令> [参数]

  check [目录或 ZIP ...]                  校验应用（默认 apps/ 下全部）
  pack <应用目录> [-o 文件]               确定性打包为 ZIP
  summary <应用目录> [-base 已发布数据]   输出评审用的权限摘要
  build [-out dist/public] [-previous 地址] [-download-base 地址]
  sign [-out dist/public] [-require-configured]   私钥取自 `+signingKeyEnv+`
  verify [-out dist/public]               校验输出中的签名与哈希
  keygen                                  生成签名密钥对`)
}

// check 接受应用目录（含 package/）、安装包内容目录（含 manifest.json）或 ZIP。
func check(args []string) error {
	targets := args
	if len(targets) == 0 {
		entries, err := os.ReadDir("apps")
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if entry.IsDir() && !strings.HasPrefix(entry.Name(), ".") {
				targets = append(targets, filepath.Join("apps", entry.Name()))
			}
		}
	}
	failed := 0
	for _, target := range targets {
		label, err := checkOne(target)
		if err != nil {
			failed++
			fmt.Printf("✗ %s：%v\n", target, err)
			continue
		}
		fmt.Printf("✓ %s %s\n", target, label)
	}
	if failed > 0 {
		return fmt.Errorf("%d 个应用未通过校验", failed)
	}
	return nil
}

func checkOne(target string) (string, error) {
	if strings.HasSuffix(strings.ToLower(target), ".zip") {
		data, err := os.ReadFile(target)
		if err != nil {
			return "", err
		}
		pkg, err := appspec.ParseZip(data)
		if err != nil {
			return "", err
		}
		return pkg.Manifest.Slug + "@" + pkg.Manifest.Version, nil
	}
	if _, err := os.Stat(filepath.Join(target, "package")); err == nil {
		app, err := build.LoadApp(target)
		if err != nil {
			return "", err
		}
		return app.Slug() + "@" + app.Package.Manifest.Version, nil
	}
	pkg, err := appspec.ParseDir(target)
	if err != nil {
		return "", err
	}
	return pkg.Manifest.Slug + "@" + pkg.Manifest.Version, nil
}

func loadPackage(target string) (*appspec.Package, error) {
	if _, err := os.Stat(filepath.Join(target, "package")); err == nil {
		app, err := build.LoadApp(target)
		if err != nil {
			return nil, err
		}
		return app.Package, nil
	}
	return appspec.ParseDir(target)
}

func pack(args []string) error {
	flags := flag.NewFlagSet("pack", flag.ExitOnError)
	output := flags.String("o", "", "输出文件，默认 <slug>-<version>.zip")
	if err := flags.Parse(reorder(args)); err != nil {
		return err
	}
	if flags.NArg() != 1 {
		return errors.New("需要一个应用目录")
	}
	pkg, err := loadPackage(flags.Arg(0))
	if err != nil {
		return err
	}
	data, err := pkg.Pack()
	if err != nil {
		return err
	}
	file := *output
	if file == "" {
		file = pkg.Manifest.Slug + "-" + pkg.Manifest.Version + ".zip"
	}
	if err := os.WriteFile(file, data, 0o644); err != nil {
		return err
	}
	fmt.Printf("%s（%d 字节，sha256 %s）\n", file, len(data), appspec.SHA256(data))
	return nil
}

func summary(args []string) error {
	flags := flag.NewFlagSet("summary", flag.ExitOnError)
	base := flags.String("base", "", "已发布数据（api/v1 目录或 URL），用于列出权限变化")
	if err := flags.Parse(reorder(args)); err != nil {
		return err
	}
	if flags.NArg() != 1 {
		return errors.New("需要一个应用目录")
	}
	app, err := build.LoadApp(flags.Arg(0))
	if err != nil {
		return err
	}
	manifest := app.Package.Manifest
	current := manifest.Summarize()
	fmt.Printf("### %s `%s@%s`\n\n%s", manifest.Name, manifest.Slug, manifest.Version, current.Markdown())
	if *base == "" {
		return nil
	}
	previous, err := publishedLatest(*base, manifest.Slug)
	if err != nil {
		return err
	}
	if previous == nil {
		fmt.Println("\n新应用，尚未发布过。")
		return nil
	}
	changes := appspec.Diff(previous.Permissions, current)
	if len(changes) == 0 {
		fmt.Printf("\n与已发布的 %s 相比，权限没有变化。\n", previous.Version)
		return nil
	}
	fmt.Printf("\n与已发布的 %s 相比的权限变化：\n\n", previous.Version)
	for _, change := range changes {
		fmt.Println("- " + change)
	}
	return nil
}

func publishedLatest(base, slug string) (*appspec.Version, error) {
	var raw []byte
	if strings.HasPrefix(base, "https://") || strings.HasPrefix(base, "http://") {
		client := &http.Client{Timeout: 30 * time.Second}
		response, err := client.Get(strings.TrimRight(base, "/") + "/apps/" + slug + ".json")
		if err != nil {
			return nil, err
		}
		defer response.Body.Close()
		if response.StatusCode == http.StatusNotFound {
			return nil, nil
		}
		if response.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("读取已发布数据失败：HTTP %d", response.StatusCode)
		}
		if raw, err = io.ReadAll(io.LimitReader(response.Body, 4<<20)); err != nil {
			return nil, err
		}
	} else {
		data, err := os.ReadFile(filepath.Join(base, "apps", slug+".json"))
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		raw = data
	}
	var detail appspec.AppDetail
	if err := json.Unmarshal(raw, &detail); err != nil {
		return nil, err
	}
	for i := range detail.Versions {
		if detail.Versions[i].Version == detail.LatestVersion {
			return &detail.Versions[i], nil
		}
	}
	return nil, nil
}

func runBuild(args []string) error {
	flags := flag.NewFlagSet("build", flag.ExitOnError)
	out := flags.String("out", "dist/public", "输出目录")
	apps := flags.String("apps", "apps", "应用源码目录")
	config := flags.String("config", "store.config.json", "商店配置")
	previous := flags.String("previous", "", "已发布数据（api/v1 目录或 URL）")
	downloadBase := flags.String("download-base", "", "安装包下载地址前缀，如 https://github.com/<owner>/<repo>/releases/download")
	if err := flags.Parse(args); err != nil {
		return err
	}
	result, err := build.Run(build.Options{AppsDir: *apps, ConfigPath: *config, OutDir: *out, Previous: *previous, DownloadBase: *downloadBase})
	if err != nil {
		return err
	}
	fmt.Printf("已生成 %d 个应用的数据，新增 %d 个版本 → %s\n", result.Apps, len(result.NewVersions), *out)
	for _, version := range result.NewVersions {
		fmt.Printf("  + %s\n", version.Tag)
	}
	return nil
}

func sign(args []string) error {
	flags := flag.NewFlagSet("sign", flag.ExitOnError)
	out := flags.String("out", "dist/public", "输出目录")
	require := flags.Bool("require-configured", false, "要求签名公钥已写入 store.config.json")
	if err := flags.Parse(args); err != nil {
		return err
	}
	key := os.Getenv(signingKeyEnv)
	if key == "" {
		return errors.New("缺少环境变量 " + signingKeyEnv)
	}
	count, err := build.Sign(build.SignOptions{OutDir: *out, PrivateKey: key, RequireConfigured: *require})
	if err != nil {
		return err
	}
	fmt.Printf("已签名 %d 个版本\n", count)
	return build.VerifyOutput(*out)
}

func verify(args []string) error {
	flags := flag.NewFlagSet("verify", flag.ExitOnError)
	out := flags.String("out", "dist/public", "输出目录")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if err := build.VerifyOutput(*out); err != nil {
		return err
	}
	fmt.Println("签名与哈希校验通过")
	return nil
}

func keygen() error {
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return err
	}
	key, _ := json.MarshalIndent(appspec.NewPublicKey(public), "", "  ")
	fmt.Fprintln(os.Stderr, "私钥（保存为 "+signingKeyEnv+"，不要提交到仓库）：")
	fmt.Println(base64.StdEncoding.EncodeToString(private.Seed()))
	fmt.Fprintln(os.Stderr, "\n公钥（写入 store.config.json 的 keys）：")
	fmt.Fprintln(os.Stderr, string(key))
	fmt.Fprintln(os.Stderr, "\n指纹："+appspec.Fingerprint(public))
	return nil
}

// reorder 把参数中的选项移到位置参数之前，允许 `pack apps/x -o out.zip` 这样的写法。
func reorder(args []string) []string {
	var options, positional []string
	for i := 0; i < len(args); i++ {
		if strings.HasPrefix(args[i], "-") {
			options = append(options, args[i])
			if !strings.Contains(args[i], "=") && i+1 < len(args) {
				options = append(options, args[i+1])
				i++
			}
			continue
		}
		positional = append(positional, args[i])
	}
	return append(options, positional...)
}

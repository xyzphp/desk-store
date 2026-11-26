package appspec

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// 格式 2 的技能组件，合同见 docs/spec/01-package-v2.md 第 9 节。

var skillNamePattern = regexp.MustCompile(`^[a-z][a-z0-9-]{1,47}$`)

// SkillInfo 是从 SKILL.md 头部读取的技能信息。
type SkillInfo struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Tools       []string `json:"tools,omitempty"`
}

// SkillInfos 返回校验后的技能信息（按清单顺序）。
func (m Manifest) SkillInfos() []SkillInfo { return append([]SkillInfo{}, m.skillInfo...) }

func (m *Manifest) validateSkills(files []File) error {
	declared := map[string]bool{}
	if len(m.Skills) > 20 {
		return errors.New("skills 过多（上限 20）")
	}
	if m.Skills != nil && len(m.Skills) == 0 {
		return errors.New("skills 不能为空数组")
	}
	tools := map[string]bool{}
	if m.MCP != nil {
		for _, tool := range m.MCP.Tools {
			tools[tool.Name] = true
		}
	}
	m.skillInfo = nil
	for _, name := range m.Skills {
		if !skillNamePattern.MatchString(name) || declared[name] {
			return fmt.Errorf("skills 中的 %q 无效或重复", name)
		}
		declared[name] = true
		file, found := fileByPath(files, "skills/"+name+"/SKILL.md")
		if !found {
			return fmt.Errorf("技能 %q 缺少 skills/%s/SKILL.md", name, name)
		}
		if len(file.Content) > 32<<10 {
			return fmt.Errorf("技能 %q 的 SKILL.md 超过 32 KB", name)
		}
		info, err := parseSkillHeader(string(file.Content))
		if err != nil {
			return fmt.Errorf("技能 %q 的 SKILL.md：%w", name, err)
		}
		if info.Name != name {
			return fmt.Errorf("技能 %q 的 SKILL.md 头部 name 必须与目录名一致", name)
		}
		for _, tool := range info.Tools {
			if !tools[tool] {
				return fmt.Errorf("技能 %q 引用的工具 %q 没有在 mcp.tools 中声明", name, tool)
			}
		}
		m.skillInfo = append(m.skillInfo, info)
	}
	references := 0
	for _, file := range files {
		rest, ok := strings.CutPrefix(file.Path, "skills/")
		if !ok {
			continue
		}
		dir, inner, _ := strings.Cut(rest, "/")
		if !declared[dir] {
			return fmt.Errorf("%q 不属于任何已声明的技能", file.Path)
		}
		if inner == "SKILL.md" {
			continue
		}
		if !strings.HasPrefix(inner, "references/") {
			return fmt.Errorf("技能目录中只允许 SKILL.md 与 references/，%q 不允许", file.Path)
		}
		references += len(file.Content)
	}
	if references > 512<<10 {
		return errors.New("技能参考文件合计超过 512 KB")
	}
	return nil
}

// parseSkillHeader 读取 SKILL.md 开头 --- 之间的头部：name、description 与可选的 tools 列表。
// 只支持 key: value、key: [a, b] 与 "- item" 列表三种写法。
func parseSkillHeader(content string) (SkillInfo, error) {
	var info SkillInfo
	text := strings.ReplaceAll(content, "\r\n", "\n")
	if !strings.HasPrefix(text, "---\n") {
		return info, errors.New("必须以 --- 开头的头部开始")
	}
	header, _, found := strings.Cut(text[4:], "\n---")
	if !found {
		return info, errors.New("头部缺少结束的 ---")
	}
	listKey := ""
	for _, line := range strings.Split(header, "\n") {
		if strings.TrimSpace(line) == "" || strings.HasPrefix(strings.TrimSpace(line), "#") {
			continue
		}
		if item, ok := strings.CutPrefix(strings.TrimSpace(line), "- "); ok && listKey == "tools" {
			info.Tools = append(info.Tools, unquote(item))
			continue
		}
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			return info, fmt.Errorf("头部行 %q 无法识别", line)
		}
		key, value = strings.TrimSpace(key), strings.TrimSpace(value)
		listKey = ""
		switch key {
		case "name":
			info.Name = unquote(value)
		case "description":
			info.Description = unquote(value)
		case "tools":
			if value == "" {
				listKey = "tools"
				continue
			}
			inner, ok := strings.CutPrefix(value, "[")
			inner, ok2 := strings.CutSuffix(inner, "]")
			if !ok || !ok2 {
				return info, errors.New("tools 必须是 [a, b] 或逐行 - a 列表")
			}
			for _, item := range strings.Split(inner, ",") {
				if item = unquote(strings.TrimSpace(item)); item != "" {
					info.Tools = append(info.Tools, item)
				}
			}
		}
	}
	if info.Name == "" {
		return info, errors.New("头部缺少 name")
	}
	if description := strings.TrimSpace(info.Description); description == "" || len([]rune(description)) > 300 {
		return info, errors.New("头部 description 必须是 1-300 个字符")
	}
	return info, nil
}

func unquote(value string) string {
	if len(value) >= 2 && (value[0] == '"' && value[len(value)-1] == '"' || value[0] == '\'' && value[len(value)-1] == '\'') {
		return value[1 : len(value)-1]
	}
	return value
}

import { useState } from "react";
import {
  CodeBlock,
  Icon,
  Inline,
  MarkdownView,
  Panel,
  Property,
  PropertySheet,
  SegmentedControl,
  Stack,
  Tag,
  Text,
} from "@xyzos/desk-ui";
import { formatBytes, type SkillSummary } from "../api";

/** 去除 SKILL.md 开头的 --- YAML 头部，保留正文 Markdown 供渲染预览。 */
function stripSkillFrontmatter(raw: string): string {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return normalized;
  const end = normalized.indexOf("\n---", 4);
  if (end < 0) return normalized;
  const after = normalized.slice(end + 4);
  if (after === "") return "";
  if (!after.startsWith("\n")) return normalized;
  return after.replace(/^\n+/, "");
}

/** 商店网站独立「技能」页签：展示技能说明、关联工具与渲染后的 SKILL.md / 参考资料文档。 */
export function SkillDetailTab({
  slug,
  skills,
  source,
}: {
  slug: string;
  skills: readonly SkillSummary[];
  source?: string;
}) {
  const [selectedSkill, setSelectedSkill] = useState(skills[0]?.name ?? "");
  const [selectedFile, setSelectedFile] = useState("SKILL.md");

  if (skills.length === 0) return null;

  const activeSkill =
    skills.find((item) => item.name === selectedSkill) ?? skills[0]!;
  const files = activeSkill.files ?? [];
  const activeFile =
    files.find((item) => item.path === selectedFile) ?? files[0];
  const singleFile = files.length === 1 ? activeFile : undefined;
  const totalSize = files.reduce((sum, item) => sum + item.size, 0);
  const isMarkdown = activeFile
    ? activeFile.path.toLowerCase().endsWith(".md")
    : false;
  const isSkillEntry = activeFile?.path === "SKILL.md";
  const renderedMarkdown =
    activeFile?.content && isMarkdown
      ? isSkillEntry
        ? stripSkillFrontmatter(activeFile.content)
        : activeFile.content
      : "";
  const skillSourceUrl = source
    ? `${source.replace(/\/+$/, "")}/package/skills/${encodeURIComponent(activeSkill.name)}`
    : "";

  const renderFileBody = () => {
    if (!activeFile) return null;
    if (!activeFile.content) {
      return (
        <Text tone="muted" size="sm">
          该文件暂无可预览的文本内容。
        </Text>
      );
    }
    if (isMarkdown) {
      return (
        <div className="store-skill-markdown">
          <MarkdownView
            className="store-markdown"
            value={renderedMarkdown || activeFile.content}
          />
        </div>
      );
    }
    return <CodeBlock code={activeFile.content} label={activeFile.path} />;
  };

  return (
    <Stack gap="md">
      {skills.length > 1 && (
        <SegmentedControl
          variant="settings"
          aria-label="选择技能"
          options={skills.map((item) => ({
            value: item.name,
            label: item.name,
          }))}
          value={activeSkill.name}
          onChange={(next) => {
            setSelectedSkill(next);
            setSelectedFile("SKILL.md");
          }}
        />
      )}
      <Panel
        title={
          <Inline gap="xs" justify="between">
            <Inline gap="xs">
              <Tag color="purple">技能</Tag>
              <Text code size="sm">{`skill:${slug}/${activeSkill.name}`}</Text>
            </Inline>
            {skillSourceUrl && (
              <a
                href={skillSourceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                在仓库中查看
              </a>
            )}
          </Inline>
        }
      >
        <Stack gap="md">
          {activeSkill.description && (
            <Text as="p" size="sm">
              {activeSkill.description}
            </Text>
          )}
          <PropertySheet density="compact">
            {activeSkill.tools && activeSkill.tools.length > 0 && (
              <Property label="关联工具">
                <Inline gap="xs">
                  {activeSkill.tools.map((tool) => (
                    <Text key={tool} code size="sm">
                      {`${slug}.${tool}`}
                    </Text>
                  ))}
                </Inline>
              </Property>
            )}
            {files.length > 0 && (
              <Property label="包含文件">{`${files.length} 个文件 · ${formatBytes(totalSize)}`}</Property>
            )}
          </PropertySheet>
        </Stack>
      </Panel>
      {singleFile ? (
        <Panel
          title={
            <Inline gap="xs" justify="between">
              <Inline gap="xs">
                <Icon name="book-open" size={15} />
                <Text code size="sm">
                  {singleFile.path}
                </Text>
              </Inline>
              <Text tone="muted" size="sm">
                {formatBytes(singleFile.size)}
              </Text>
            </Inline>
          }
        >
          {renderFileBody()}
        </Panel>
      ) : (
        <Panel title={`技能文档与参考资料（${files.length}）`}>
          {files.length === 0 ? (
            <Text tone="muted" size="sm">
              当前数据暂未附带技能文件正文。
            </Text>
          ) : (
            <div className="store-skill-browser">
              <div
                className="store-skill-file-list"
                role="group"
                aria-label="技能文件列表"
              >
                {files.map((file) => {
                  const selected = file.path === activeFile?.path;
                  const entry = file.path === "SKILL.md";
                  return (
                    <button
                      key={file.path}
                      type="button"
                      className="store-skill-file-item"
                      aria-pressed={selected}
                      onClick={() => setSelectedFile(file.path)}
                    >
                      <Inline gap="xs">
                        <Icon
                          name={entry ? "book-open" : "file-text"}
                          size={14}
                        />
                        <span className="store-skill-file-path">
                          {file.path}
                        </span>
                      </Inline>
                      <span className="store-skill-file-meta">
                        <Tag tone={entry ? "info" : "muted"}>
                          {entry ? "主文档" : "参考资料"}
                        </Tag>
                        <span>{formatBytes(file.size)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {activeFile && (
                <div className="store-skill-viewer">
                  <div className="store-skill-viewer-head">
                    <Inline gap="xs">
                      <Text
                        code
                        size="sm"
                      >{`skills/${activeSkill.name}/${activeFile.path}`}</Text>
                      <Text tone="muted" size="sm">
                        {formatBytes(activeFile.size)}
                      </Text>
                    </Inline>
                  </div>
                  {renderFileBody()}
                </div>
              )}
            </div>
          )}
        </Panel>
      )}
    </Stack>
  );
}

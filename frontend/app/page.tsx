"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  createProject,
  listProjectFiles,
  readProjectFile,
  resolvePreviewUrl,
  saveProjectFile,
  sendChat,
  type ChatResponse,
} from "@/lib/api";
import {
  bootViteReactProject,
  getWebContainer,
  writeFilesToWebContainer,
} from "@/lib/webcontainer/runtime";

type PromptOption = {
  label: string;
  description?: string;
};

const WEBSITE_TYPE_OPTIONS: PromptOption[] = [
  { label: "品牌形象官網", description: "公司、工作室、個人品牌、顧問服務" },
  { label: "SaaS / 產品 Landing Page", description: "App、AI 工具、數位產品、訂閱服務" },
  { label: "電商 / 商品銷售網站", description: "服飾、美妝、食品、3C、生活用品" },
  { label: "餐廳 / 咖啡廳網站", description: "餐飲品牌、咖啡廳、酒吧、甜點店" },
  { label: "個人作品集 / 履歷網站", description: "設計師、工程師、攝影師、自由工作者" },
  { label: "活動 / 課程報名頁", description: "講座、工作坊、線上課程、產品發表會" },
  { label: "部落格 / 內容媒體網站", description: "知識型網站、旅遊、美食、技術文章" },
];

const DESIGN_STYLE_OPTIONS = [
  "現代極簡",
  "高級精品",
  "科技感",
  "溫暖生活感",
  "年輕活潑",
  "專業穩重",
  "暗色模式",
];

const COLOR_PALETTE_OPTIONS = [
  "黑白灰極簡",
  "深色背景 + 紫色強調",
  "白色 + 藍色科技感",
  "米色 + 棕色溫暖風",
  "粉色 + 奶油色柔和風",
  "綠色自然風",
];

const SECTION_OPTIONS = [
  "Hero 主視覺",
  "導覽列",
  "服務 / 功能介紹",
  "商品 / 作品卡片",
  "價格方案",
  "客戶評價",
  "FAQ",
  "聯絡表單",
  "地圖 / 地址資訊",
  "Footer",
];

const DEFAULT_SECTIONS = [
  "Hero 主視覺",
  "導覽列",
  "服務 / 功能介紹",
  "客戶評價",
  "聯絡表單",
  "Footer",
];

function splitCustomItems(value: string): string[] {
  return value
    .split(/[\n,，、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeTerminalLog(line: string): string {
  return line
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\[(?:\d+[A-Z]|\d+G|\d+K|K)/g, "")
    .replace(/[^\S\r\n]{80,}/g, " ");
}

function buildWebsitePrompt({
  websiteType,
  designStyle,
  colorPalette,
  sections,
  cta,
  customDetails,
}: {
  websiteType: string;
  designStyle: string;
  colorPalette: string;
  sections: string[];
  cta: string;
  customDetails: string;
}) {
  const promptLines = [
    `請建立一個「${websiteType}」。`,
    `設計風格採「${designStyle}」，配色使用「${colorPalette}」。`,
    `網站需要包含：${sections.join("、")}。`,
  ];

  if (cta) {
    promptLines.push(`主要 CTA 為「${cta}」。`);
  }

  if (customDetails) {
    promptLines.push(`補充客製化需求：${customDetails}`);
  }

  promptLines.push(
    "請使用多檔案 React component 架構，將主要區塊拆成可維護的 components。",
    "請統一設計 tokens、間距、字級、圓角與互動狀態，避免每個區塊風格不一致。",
    "版面需支援響應式設計，桌機版可使用多欄 layout，手機版需改為單欄且不可產生水平捲動。",
    "若缺少真實圖片、影音、地圖、價格、營業時間或其他事實資料，請使用 placeholder 並標示「資料待補」，不要捏造不存在的資訊或引用不存在的本地資產。",
  );

  return promptLines.join("\n");
}

export default function BuilderPage() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [websiteType, setWebsiteType] = useState(WEBSITE_TYPE_OPTIONS[0].label);
  const [customWebsiteType, setCustomWebsiteType] = useState("");
  const [designStyle, setDesignStyle] = useState(DESIGN_STYLE_OPTIONS[0]);
  const [customDesignStyle, setCustomDesignStyle] = useState("");
  const [colorPalette, setColorPalette] = useState(COLOR_PALETTE_OPTIONS[0]);
  const [customColorPalette, setCustomColorPalette] = useState("");
  const [sections, setSections] = useState(DEFAULT_SECTIONS);
  const [customSections, setCustomSections] = useState("");
  const [cta, setCta] = useState("立即聯絡");
  const [customDetails, setCustomDetails] = useState("");
  const [reviewingPrompt, setReviewingPrompt] = useState(false);
  const [editMessage, setEditMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingHint, setLoadingHint] = useState("生成中...");
  const [bootstrapping, setBootstrapping] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ChatResponse | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [projectFiles, setProjectFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [savedFileContent, setSavedFileContent] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [fileSaving, setFileSaving] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [webPreviewUrl, setWebPreviewUrl] = useState<string | null>(null);
  const [webLogs, setWebLogs] = useState<string[]>([]);
  const [webBooting, setWebBooting] = useState(false);
  const [webError, setWebError] = useState<string | null>(null);

  const fileIsDirty = selectedFile !== null && fileContent !== savedFileContent;
  const activePreviewUrl = webPreviewUrl ?? previewUrl;
  const previewSource = webPreviewUrl ? "live" : previewUrl ? "verified" : "none";

  const finalPrompt = useMemo(() => {
    const selectedSections = [...sections, ...splitCustomItems(customSections)];

    return buildWebsitePrompt({
      websiteType: customWebsiteType.trim() || websiteType,
      designStyle: customDesignStyle.trim() || designStyle,
      colorPalette: customColorPalette.trim() || colorPalette,
      sections: selectedSections.length > 0 ? selectedSections : ["Hero 主視覺", "Footer"],
      cta: cta.trim(),
      customDetails: customDetails.trim(),
    });
  }, [
    colorPalette,
    cta,
    customColorPalette,
    customDetails,
    customDesignStyle,
    customSections,
    customWebsiteType,
    designStyle,
    sections,
    websiteType,
  ]);

  useEffect(() => {
    let cancelled = false;

    createProject()
      .then((project) => {
        if (!cancelled) {
          setProjectId(project.project_id);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "無法建立專案");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBootstrapping(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loading) {
      return;
    }

    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);

      if (elapsed < 45) {
        setLoadingHint("規劃檔案並生成程式碼…");
      } else if (elapsed < 120) {
        setLoadingHint("同步檔案並執行 production build…");
      } else {
        setLoadingHint("build 失敗時會自動修復並重試…");
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [loading]);

  const refreshProjectFiles = useCallback(async () => {
    if (!projectId) {
      return;
    }

    try {
      setFileError(null);
      const files = await listProjectFiles(projectId);
      setProjectFiles(files);
    } catch (err: unknown) {
      setFileError(err instanceof Error ? err.message : "無法載入檔案列表");
    }
  }, [projectId]);

  useEffect(() => {
    void refreshProjectFiles();
  }, [refreshProjectFiles]);

  async function openProjectFile(path: string) {
    if (!projectId || path === selectedFile) {
      return;
    }

    if (fileIsDirty && !window.confirm("目前檔案尚未儲存，確定要切換檔案嗎？")) {
      return;
    }

    setFileLoading(true);
    setFileError(null);

    try {
      const file = await readProjectFile(projectId, path);
      setSelectedFile(file.path);
      setFileContent(file.content);
      setSavedFileContent(file.content);
    } catch (err: unknown) {
      setFileError(err instanceof Error ? err.message : "無法讀取檔案");
    } finally {
      setFileLoading(false);
    }
  }

  async function saveCurrentFile() {
    if (!projectId || !selectedFile) {
      return;
    }

    setFileSaving(true);
    setFileError(null);

    try {
      await saveProjectFile(projectId, selectedFile, fileContent);
      setSavedFileContent(fileContent);
      await refreshProjectFiles();

      if (webPreviewUrl) {
        await writeFilesToWebContainer(
          [{ path: selectedFile, content: fileContent }],
          {
            onLog: (line) => setWebLogs((current) => [...current, normalizeTerminalLog(line)]),
            onServerReady: (url) => setWebPreviewUrl(url),
          },
        );
      }
    } catch (err: unknown) {
      setFileError(err instanceof Error ? err.message : "無法儲存檔案");
    } finally {
      setFileSaving(false);
    }
  }

  async function startWebContainerMvp() {
    setWebBooting(true);
    setWebError(null);
    setWebLogs([]);

    try {
      await bootViteReactProject({
        onLog: (line) => setWebLogs((current) => [...current, normalizeTerminalLog(line)]),
        onServerReady: (url) => setWebPreviewUrl(url),
      });
    } catch (err: unknown) {
      setWebError(err instanceof Error ? err.message : "WebContainer 啟動失敗");
    } finally {
      setWebBooting(false);
    }
  }

  async function testWebContainerHmr() {
    setWebError(null);

    try {
      const webcontainer = await getWebContainer();
      await webcontainer.fs.writeFile(
        "/src/App.tsx",
        [
          'import React from "react";',
          "",
          "console.info('Rendering HMR updated App.tsx');",
          "",
          "export default function App() {",
          "  return (",
          '    <main className="shell">',
          '      <section className="card">',
          '        <p className="eyebrow">HMR 測試成功</p>',
          "        <h1>App.tsx 已被即時更新</h1>",
          "        <p>這段文字是透過 WebContainer FS 寫入的。</p>",
          "      </section>",
          "    </main>",
          "  );",
          "}",
        ].join("\n"),
      );
      setWebLogs((current) => [...current, "Updated /src/App.tsx for HMR test.\n"]);
    } catch (err: unknown) {
      setWebError(err instanceof Error ? err.message : "HMR 測試失敗");
    }
  }

  async function syncChatResponseToWebContainer(response: ChatResponse) {
    if (response.changed_files.length === 0) {
      return;
    }

    setWebBooting(true);
    setWebError(null);

    try {
      await writeFilesToWebContainer(response.changed_files, {
        onLog: (line) => setWebLogs((current) => [...current, normalizeTerminalLog(line)]),
        onServerReady: (url) => setWebPreviewUrl(url),
      });

      const selectedUpdate = selectedFile
        ? response.changed_files.find((file) => file.path === selectedFile)
        : undefined;

      if (selectedUpdate) {
        setFileContent(selectedUpdate.content);
        setSavedFileContent(selectedUpdate.content);
      }
    } catch (err: unknown) {
      setWebError(err instanceof Error ? err.message : "無法同步檔案到 WebContainer");
    } finally {
      setWebBooting(false);
    }
  }

  function updateDraft(update: () => void) {
    update();
    setReviewingPrompt(false);
  }

  function toggleSection(section: string) {
    updateDraft(() => {
      setSections((current) =>
        current.includes(section)
          ? current.filter((item) => item !== section)
          : [...current, section],
      );
    });
  }

  async function handleBuilderSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId) {
      return;
    }

    if (!reviewingPrompt) {
      setReviewingPrompt(true);
      return;
    }

    setLoading(true);
    setLoadingHint("生成中...");
    setError(null);
    setPreviewUrl(null);

    try {
      const response = await sendChat(projectId, finalPrompt, "generate");
      const version = Date.now();
      setResult(response);
      setEditMessage("");
      setReviewingPrompt(true);
      setPreviewKey(version);
      setPreviewUrl(resolvePreviewUrl(response.preview_url, version));
      await refreshProjectFiles();
      await syncChatResponseToWebContainer(response);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "生成失敗");
    } finally {
      setLoading(false);
      setLoadingHint("生成中...");
    }
  }

  async function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId || !editMessage.trim()) {
      return;
    }

    setLoading(true);
    setLoadingHint("生成中...");
    setError(null);
    setPreviewUrl(null);

    try {
      const response = await sendChat(projectId, editMessage.trim(), "edit");
      const version = Date.now();
      setResult(response);
      setEditMessage("");
      setPreviewKey(version);
      setPreviewUrl(resolvePreviewUrl(response.preview_url, version));
      await refreshProjectFiles();
      await syncChatResponseToWebContainer(response);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "生成失敗");
    } finally {
      setLoading(false);
      setLoadingHint("生成中...");
    }
  }

  return (
    <div className="min-h-full bg-zinc-50 text-zinc-900">
      <div className="mx-auto flex min-h-full max-w-7xl flex-col gap-6 px-4 py-8 lg:flex-row">
        <section className="flex w-full flex-col gap-4 lg:w-[520px] lg:shrink-0">
          <div>
            <p className="text-sm font-medium text-zinc-500">website-builder-agent</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              AI 網站建置
            </h1>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              先選擇網站類型、風格、配色與區塊，再確認完整 Prompt 後送給 Agent 生成網站。首次生成通常需要 2-5 分鐘。
            </p>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm">
            <p className="font-medium text-zinc-700">專案 ID</p>
            <p className="mt-1 break-all font-mono text-zinc-900">
              {bootstrapping ? "建立中..." : projectId ?? "—"}
            </p>
          </div>

          <form onSubmit={handleBuilderSubmit} className="flex flex-col gap-3">
            <div>
              <p className="text-sm font-medium text-zinc-700">建站 Prompt</p>
              <p className="mt-1 text-xs leading-5 text-zinc-500">
                這裡會保留完整建站需求。生成後可修改選項並重新生成，重新生成會覆寫目前預覽。
              </p>
            </div>
                <div className="rounded-xl border border-zinc-200 bg-white p-4">
                  <label htmlFor="websiteType" className="text-sm font-medium text-zinc-700">
                    網站類型
                  </label>
                  <select
                    id="websiteType"
                    value={websiteType}
                    onChange={(event) => updateDraft(() => setWebsiteType(event.target.value))}
                    className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:ring-2"
                    disabled={bootstrapping || loading || !projectId}
                  >
                    {WEBSITE_TYPE_OPTIONS.map((option) => (
                      <option key={option.label} value={option.label}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-xs text-zinc-500">
                    {WEBSITE_TYPE_OPTIONS.find((option) => option.label === websiteType)?.description}
                  </p>
                  <input
                    value={customWebsiteType}
                    onChange={(event) => updateDraft(() => setCustomWebsiteType(event.target.value))}
                    className="mt-3 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:ring-2"
                    placeholder="或輸入自訂網站類型，例如：醫美診所預約網站"
                    disabled={bootstrapping || loading || !projectId}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-zinc-200 bg-white p-4">
                    <label htmlFor="designStyle" className="text-sm font-medium text-zinc-700">
                      設計風格
                    </label>
                    <select
                      id="designStyle"
                      value={designStyle}
                      onChange={(event) => updateDraft(() => setDesignStyle(event.target.value))}
                      className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:ring-2"
                      disabled={bootstrapping || loading || !projectId}
                    >
                      {DESIGN_STYLE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    <input
                      value={customDesignStyle}
                      onChange={(event) => updateDraft(() => setCustomDesignStyle(event.target.value))}
                      className="mt-3 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:ring-2"
                      placeholder="或輸入自訂風格"
                      disabled={bootstrapping || loading || !projectId}
                    />
                  </div>

                  <div className="rounded-xl border border-zinc-200 bg-white p-4">
                    <label htmlFor="colorPalette" className="text-sm font-medium text-zinc-700">
                      配色
                    </label>
                    <select
                      id="colorPalette"
                      value={colorPalette}
                      onChange={(event) => updateDraft(() => setColorPalette(event.target.value))}
                      className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:ring-2"
                      disabled={bootstrapping || loading || !projectId}
                    >
                      {COLOR_PALETTE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    <input
                      value={customColorPalette}
                      onChange={(event) => updateDraft(() => setCustomColorPalette(event.target.value))}
                      className="mt-3 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:ring-2"
                      placeholder="或輸入自訂配色"
                      disabled={bootstrapping || loading || !projectId}
                    />
                  </div>
                </div>

                <div className="rounded-xl border border-zinc-200 bg-white p-4">
                  <p className="text-sm font-medium text-zinc-700">主要區塊（可複選）</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {SECTION_OPTIONS.map((section) => (
                      <label
                        key={section}
                        className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-700"
                      >
                        <input
                          type="checkbox"
                          checked={sections.includes(section)}
                          onChange={() => toggleSection(section)}
                          disabled={bootstrapping || loading || !projectId}
                        />
                        {section}
                      </label>
                    ))}
                  </div>
                  <input
                    value={customSections}
                    onChange={(event) => updateDraft(() => setCustomSections(event.target.value))}
                    className="mt-3 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:ring-2"
                    placeholder="其他區塊，可用逗號或換行分隔，例如：時間軸、團隊介紹"
                    disabled={bootstrapping || loading || !projectId}
                  />
                </div>

                <div className="rounded-xl border border-zinc-200 bg-white p-4">
                  <label htmlFor="cta" className="text-sm font-medium text-zinc-700">
                    CTA 與客製化內容
                  </label>
                  <input
                    id="cta"
                    value={cta}
                    onChange={(event) => updateDraft(() => setCta(event.target.value))}
                    className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:ring-2"
                    placeholder="例如：預約 Demo、立即訂位、查看作品"
                    disabled={bootstrapping || loading || !projectId}
                  />
                  <textarea
                    value={customDetails}
                    onChange={(event) => updateDraft(() => setCustomDetails(event.target.value))}
                    rows={4}
                    className="mt-3 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm leading-6 outline-none ring-zinc-400 focus:ring-2"
                    placeholder="補充品牌名稱、目標客群、一定要出現的文案、特殊功能或資料。"
                    disabled={bootstrapping || loading || !projectId}
                  />
                </div>

                {reviewingPrompt ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-emerald-900">
                        {result ? "目前保留的完整 Prompt" : "即將送給 AI 的完整 Prompt"}
                      </p>
                      <button
                        type="button"
                        onClick={() => setReviewingPrompt(false)}
                        className="text-sm text-emerald-800 underline underline-offset-4"
                        disabled={loading}
                      >
                        返回修改
                      </button>
                    </div>
                    <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-xs leading-5 text-zinc-700">
                      {finalPrompt}
                    </pre>
                    {result ? (
                      <p className="mt-3 text-xs leading-5 text-emerald-900">
                        若你修改選項後再次確認，系統會放棄目前版本並用新的完整 Prompt 重新生成網站。
                      </p>
                    ) : null}
                  </div>
                ) : null}
            <button
              type="submit"
              disabled={bootstrapping || loading || !projectId}
              className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
            >
              {loading
                ? loadingHint
                : reviewingPrompt
                  ? result
                    ? "確認並重新生成網站"
                    : "確認並生成網站"
                  : "產生完整 Prompt"}
            </button>
          </form>

          {result ? (
            <form onSubmit={handleEditSubmit} className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4">
              <div>
                <label htmlFor="editPrompt" className="text-sm font-medium text-zinc-700">
                  微調需求
                </label>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  用目前網站為基礎做小幅修改，不會重新規劃整個網站。
                </p>
              </div>
              <textarea
                id="editPrompt"
                rows={5}
                value={editMessage}
                onChange={(event) => setEditMessage(event.target.value)}
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm leading-6 outline-none ring-zinc-400 focus:ring-2"
                placeholder="例如：改成深色風格，並把排行榜移到右側"
                disabled={bootstrapping || loading || !projectId}
              />
              <button
                type="submit"
                disabled={bootstrapping || loading || !projectId || !editMessage.trim()}
                className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
              >
                {loading ? loadingHint : "套用微調"}
              </button>
            </form>
          ) : null}

          {loading ? (
            <p className="text-sm text-zinc-500">
              請保持後端 terminal 開啟，並觀察 uvicorn 日誌（npm install / build 進度）。
            </p>
          ) : null}

          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {result ? (
            <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm">
              <p className="font-medium text-zinc-700">{result.message}</p>
              <p className="mt-2 text-zinc-600">{result.reply}</p>
              {result.files.length > 0 ? (
                <ul className="mt-3 list-inside list-disc text-zinc-600">
                  {result.files.map((file) => (
                    <li key={file}>{file}</li>
                  ))}
                </ul>
              ) : null}
              {result.fix_attempts > 0 ? (
                <p className="mt-3 text-zinc-500">
                  自動修復 {result.fix_attempts} 次
                  {result.build_attempts > 0
                    ? `，build 嘗試 ${result.build_attempts} 次後成功`
                    : ""}
                </p>
              ) : null}
              {result.warnings.length > 0 ? (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                  <p className="font-medium">資訊/資產警告</p>
                  <ul className="mt-2 list-inside list-disc">
                    {result.warnings.map((warning, index) => (
                      <li key={`${warning.kind}-${warning.path ?? warning.url ?? index}`}>
                        {warning.message}
                        {warning.fallback ? `（${warning.fallback}）` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="flex min-h-[70vh] min-w-0 flex-1 flex-col gap-4">
          <div className="min-w-0 overflow-hidden rounded-xl border border-sky-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-sky-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-sm font-medium text-sky-900">WebContainer MVP</h2>
                <p className="mt-1 text-xs leading-5 text-sky-700">
                  第一階段驗證：在瀏覽器內建立 Vite React 專案、執行 npm install / npm run dev，並用 iframe 顯示 HMR 預覽。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void startWebContainerMvp()}
                  className="rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-sky-300"
                  disabled={webBooting}
                >
                  {webBooting ? "啟動中..." : webPreviewUrl ? "重新啟動檢查" : "啟動 WebContainer"}
                </button>
                <button
                  type="button"
                  onClick={() => void testWebContainerHmr()}
                  className="rounded-lg border border-sky-200 px-3 py-1.5 text-xs font-medium text-sky-800 transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:text-sky-300"
                  disabled={!webPreviewUrl || webBooting}
                >
                  測試 HMR
                </button>
              </div>
            </div>

            <div className="p-4">
              <div className="mb-3 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-800">
                {webPreviewUrl
                  ? "WebContainer live preview 已啟動。下方唯一的 Preview 區塊會顯示即時 HMR 預覽。"
                  : "按下「啟動 WebContainer」後，下方 Preview 會切換成瀏覽器內 Vite dev server 的即時預覽。"}
              </div>
              {webError ? (
                <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {webError}
                </div>
              ) : null}
              <pre className="block max-h-44 min-w-0 max-w-full overflow-auto whitespace-pre-wrap break-all rounded-lg bg-zinc-950 p-3 text-xs leading-5 text-zinc-100">
                {webLogs.length > 0 ? webLogs.join("") : "WebContainer logs will appear here."}
              </pre>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
              <div>
                <h2 className="text-sm font-medium text-zinc-700">IDE</h2>
                <p className="mt-1 text-xs text-zinc-500">
                  直接查看與修改目前專案檔案。儲存後可再用微調或重新生成更新預覽。
                </p>
              </div>
              <button
                type="button"
                onClick={() => void refreshProjectFiles()}
                className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
                disabled={!projectId || fileLoading || fileSaving}
              >
                重新整理
              </button>
            </div>

            <div className="grid min-h-[360px] overflow-hidden lg:grid-cols-[240px_1fr]">
              <div className="border-b border-zinc-200 bg-zinc-50 lg:border-b-0 lg:border-r">
                <div className="max-h-[360px] overflow-auto p-2">
                  {projectFiles.length > 0 ? (
                    projectFiles.map((file) => (
                      <button
                        key={file}
                        type="button"
                        onClick={() => void openProjectFile(file)}
                        className={`block w-full rounded-lg px-2 py-1.5 text-left font-mono text-xs transition ${
                          selectedFile === file
                            ? "bg-zinc-900 text-white"
                            : "text-zinc-700 hover:bg-white"
                        }`}
                        style={{ paddingLeft: `${8 + Math.max(file.split("/").length - 1, 0) * 10}px` }}
                        disabled={fileLoading || fileSaving}
                      >
                        {file}
                      </button>
                    ))
                  ) : (
                    <p className="px-2 py-3 text-xs leading-5 text-zinc-500">
                      尚未找到可編輯檔案。建立專案後會自動載入 template 檔案。
                    </p>
                  )}
                </div>
              </div>

              <div className="flex min-h-[360px] flex-col">
                <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-2">
                  <p className="truncate font-mono text-xs text-zinc-600">
                    {selectedFile ?? "尚未選取檔案"}
                    {fileIsDirty ? " *" : ""}
                  </p>
                  <button
                    type="button"
                    onClick={() => void saveCurrentFile()}
                    className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
                    disabled={!selectedFile || !fileIsDirty || fileLoading || fileSaving}
                  >
                    {fileSaving ? "儲存中..." : "儲存檔案"}
                  </button>
                </div>

                {selectedFile ? (
                  <textarea
                    value={fileContent}
                    onChange={(event) => setFileContent(event.target.value)}
                    spellCheck={false}
                    className="min-h-[320px] flex-1 resize-y border-0 bg-zinc-950 p-4 font-mono text-xs leading-5 text-zinc-50 outline-none"
                    disabled={fileLoading || fileSaving}
                  />
                ) : (
                  <div className="flex min-h-[320px] flex-1 items-center justify-center px-6 text-center text-sm text-zinc-500">
                    從左側選擇一個檔案開始編輯。
                  </div>
                )}
              </div>
            </div>

            {fileError ? (
              <div className="border-t border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
                {fileError}
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium text-zinc-700">Preview</h2>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  previewSource === "live"
                    ? "bg-sky-100 text-sky-800"
                    : previewSource === "verified"
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-zinc-100 text-zinc-500"
                }`}
              >
                {previewSource === "live"
                  ? "Live"
                  : previewSource === "verified"
                    ? "Verified"
                    : "No preview"}
              </span>
            </div>
            {activePreviewUrl ? (
              <a
                href={activePreviewUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-zinc-600 underline underline-offset-4 hover:text-zinc-900"
              >
                在新分頁開啟
              </a>
            ) : null}
          </div>

          <div className="flex flex-1 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
            {loading ? (
              <div className="flex h-full min-h-[70vh] w-full items-center justify-center px-6 text-center text-sm text-zinc-500">
                正在生成新版本，完成後會自動更新預覽…
              </div>
            ) : activePreviewUrl ? (
              <iframe
                key={`${previewSource}-${previewKey}-${activePreviewUrl}`}
                title="Website preview"
                src={activePreviewUrl}
                className="h-full min-h-[70vh] w-full"
              />
            ) : (
              <div className="flex h-full min-h-[70vh] w-full items-center justify-center px-6 text-center text-sm text-zinc-500">
                送出需求後，生成的網站會顯示在這裡。
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

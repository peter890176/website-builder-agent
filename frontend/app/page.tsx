"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";

import {
  applyProjectEdit,
  createProjectFile,
  createProject,
  deleteProjectFile,
  getProjectDiagnostics,
  listProjectFiles,
  previewProjectEdit,
  readProjectFile,
  renameProjectFile,
  resolvePreviewUrl,
  runProjectBuild,
  saveProjectFile,
  sendChat,
  type ChatResponse,
  type ProjectDiagnosticsResponse,
  type ProjectEditPreviewResponse,
} from "@/lib/api";
import {
  bootViteReactProject,
  deleteFileFromWebContainer,
  getWebContainer,
  renameFileInWebContainer,
  writeFilesToWebContainer,
} from "@/lib/webcontainer/runtime";

type PromptOption = {
  label: string;
  description?: string;
};

type FileTreeNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  children: FileTreeNode[];
};

type MonacoEditorInstance = {
  addCommand: (keybinding: number, handler: () => void) => void;
};

type MonacoApi = {
  KeyMod: { CtrlCmd: number };
  KeyCode: { KeyS: number };
};

const MonacoEditor = dynamic(() => import("@monaco-editor/react").then((mod) => mod.default), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-[320px] flex-1 items-center justify-center bg-zinc-950 text-sm text-zinc-400">
      Monaco Editor 載入中...
    </div>
  ),
});

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

function buildFileTree(files: string[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];

  for (const file of files) {
    const parts = file.split("/");
    let currentLevel = root;
    let currentPath = "";

    parts.forEach((part, index) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isFile = index === parts.length - 1;
      let node = currentLevel.find((item) => item.name === part && item.type === (isFile ? "file" : "folder"));

      if (!node) {
        node = {
          name: part,
          path: currentPath,
          type: isFile ? "file" : "folder",
          children: [],
        };
        currentLevel.push(node);
        currentLevel.sort((a, b) => {
          if (a.type !== b.type) {
            return a.type === "folder" ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });
      }

      currentLevel = node.children;
    });
  }

  return root;
}

function defaultFileContent(path: string): string {
  if (path.endsWith(".tsx") || path.endsWith(".jsx")) {
    const componentName = path
      .split("/")
      .pop()
      ?.replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9]/g, "") || "Component";

    return [
      'import React from "react";',
      "",
      `export function ${componentName}() {`,
      "  return <div>New component</div>;",
      "}",
      "",
    ].join("\n");
  }

  if (path.endsWith(".ts") || path.endsWith(".js")) {
    return "export {};\n";
  }

  if (path.endsWith(".css")) {
    return "";
  }

  if (path.endsWith(".json")) {
    return "{}\n";
  }

  return "";
}

function languageForFile(path: string | null): string {
  if (!path) {
    return "plaintext";
  }

  if (path.endsWith(".tsx") || path.endsWith(".jsx")) {
    return "typescript";
  }
  if (path.endsWith(".ts")) {
    return "typescript";
  }
  if (path.endsWith(".js")) {
    return "javascript";
  }
  if (path.endsWith(".css")) {
    return "css";
  }
  if (path.endsWith(".json") || path.endsWith(".geojson")) {
    return "json";
  }
  if (path.endsWith(".html")) {
    return "html";
  }
  if (path.endsWith(".svg")) {
    return "xml";
  }

  return "plaintext";
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
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [fileSearch, setFileSearch] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [savedFileContent, setSavedFileContent] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [fileSaving, setFileSaving] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [webPreviewUrl, setWebPreviewUrl] = useState<string | null>(null);
  const [webLogs, setWebLogs] = useState<string[]>([]);
  const [webBooting, setWebBooting] = useState(false);
  const [webError, setWebError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<ProjectDiagnosticsResponse | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  const [editPreview, setEditPreview] = useState<ProjectEditPreviewResponse | null>(null);
  const [editPreviewLoading, setEditPreviewLoading] = useState(false);
  const [editApplyLoading, setEditApplyLoading] = useState(false);
  const [editPreviewError, setEditPreviewError] = useState<string | null>(null);
  const saveCurrentFileRef = useRef<() => void>(() => {});

  const fileIsDirty = selectedFile !== null && fileContent !== savedFileContent;
  const activePreviewUrl = webPreviewUrl ?? previewUrl;
  const previewSource = webPreviewUrl ? "live" : previewUrl ? "verified" : "none";
  const changedFiles = result?.changed_files ?? [];
  const filteredProjectFiles = useMemo(() => {
    const query = fileSearch.trim().toLowerCase();
    if (!query) {
      return projectFiles;
    }
    return projectFiles.filter((file) => file.toLowerCase().includes(query));
  }, [fileSearch, projectFiles]);
  const fileTree = useMemo(() => buildFileTree(filteredProjectFiles), [filteredProjectFiles]);
  const hasBuildDiagnostics = Boolean(
    projectId
      || diagnostics
      || (result && (result.build_log || result.build_attempts > 0 || result.fix_attempts > 0 || result.warnings.length > 0)),
  );

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

  const refreshDiagnostics = useCallback(async () => {
    if (!projectId) {
      return;
    }

    try {
      setDiagnosticsError(null);
      const nextDiagnostics = await getProjectDiagnostics(projectId);
      setDiagnostics(nextDiagnostics);
    } catch (err: unknown) {
      setDiagnosticsError(err instanceof Error ? err.message : "無法載入 diagnostics");
    }
  }, [projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshProjectFiles();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshProjectFiles]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshDiagnostics();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshDiagnostics]);

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
      setOpenFiles((current) => current.includes(file.path) ? current : [...current, file.path]);
      setFileContent(file.content);
      setSavedFileContent(file.content);
    } catch (err: unknown) {
      setFileError(err instanceof Error ? err.message : "無法讀取檔案");
    } finally {
      setFileLoading(false);
    }
  }

  const saveCurrentFile = useCallback(async () => {
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
  }, [fileContent, projectId, refreshProjectFiles, selectedFile, webPreviewUrl]);

  useEffect(() => {
    saveCurrentFileRef.current = () => {
      if (selectedFile && fileIsDirty && !fileSaving && !fileLoading) {
        void saveCurrentFile();
      }
    };
  }, [fileIsDirty, fileLoading, fileSaving, saveCurrentFile, selectedFile]);

  async function runBackendBuild() {
    if (!projectId) {
      return;
    }

    setDiagnosticsLoading(true);
    setDiagnosticsError(null);

    try {
      const nextDiagnostics = await runProjectBuild(projectId);
      setDiagnostics(nextDiagnostics);
      if (nextDiagnostics.preview_url) {
        const version = Date.now();
        setPreviewKey(version);
        setPreviewUrl(resolvePreviewUrl(nextDiagnostics.preview_url, version));
      }
    } catch (err: unknown) {
      setDiagnosticsError(err instanceof Error ? err.message : "後端驗證失敗");
    } finally {
      setDiagnosticsLoading(false);
    }
  }

  useEffect(() => {
    function handleSaveShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (selectedFile && fileIsDirty && !fileSaving && !fileLoading) {
          void saveCurrentFile();
        }
      }
    }

    window.addEventListener("keydown", handleSaveShortcut);
    return () => window.removeEventListener("keydown", handleSaveShortcut);
  }, [fileIsDirty, fileLoading, fileSaving, saveCurrentFile, selectedFile]);

  async function createNewFile() {
    if (!projectId) {
      return;
    }

    const path = window.prompt("輸入新檔案路徑，例如 src/components/Hero.tsx");
    const normalizedPath = path?.trim().replace(/\\/g, "/");
    if (!normalizedPath) {
      return;
    }

    if (fileIsDirty && !window.confirm("目前檔案尚未儲存，建立新檔案後會切換編輯器，確定繼續嗎？")) {
      return;
    }

    const content = defaultFileContent(normalizedPath);
    setFileSaving(true);
    setFileError(null);

    try {
      await createProjectFile(projectId, normalizedPath, content);
      await refreshProjectFiles();
      setSelectedFile(normalizedPath);
      setOpenFiles((current) => current.includes(normalizedPath) ? current : [...current, normalizedPath]);
      setFileContent(content);
      setSavedFileContent(content);

      if (webPreviewUrl) {
        await writeFilesToWebContainer([{ path: normalizedPath, content }], {
          onLog: (line) => setWebLogs((current) => [...current, normalizeTerminalLog(line)]),
          onServerReady: (url) => setWebPreviewUrl(url),
        });
      }
    } catch (err: unknown) {
      setFileError(err instanceof Error ? err.message : "無法建立檔案");
    } finally {
      setFileSaving(false);
    }
  }

  async function renameCurrentFile() {
    if (!projectId || !selectedFile) {
      return;
    }

    const path = window.prompt("輸入新的檔案路徑", selectedFile);
    const normalizedPath = path?.trim().replace(/\\/g, "/");
    if (!normalizedPath || normalizedPath === selectedFile) {
      return;
    }

    setFileSaving(true);
    setFileError(null);

    try {
      await renameProjectFile(projectId, selectedFile, normalizedPath);
      await refreshProjectFiles();

      if (webPreviewUrl) {
        await renameFileInWebContainer(selectedFile, normalizedPath, (line) =>
          setWebLogs((current) => [...current, normalizeTerminalLog(line)]),
        );
      }

      setSelectedFile(normalizedPath);
      setOpenFiles((current) => current.map((file) => file === selectedFile ? normalizedPath : file));
    } catch (err: unknown) {
      setFileError(err instanceof Error ? err.message : "無法重新命名檔案");
    } finally {
      setFileSaving(false);
    }
  }

  async function deleteCurrentFile() {
    if (!projectId || !selectedFile) {
      return;
    }

    if (!window.confirm(`確定要刪除 ${selectedFile} 嗎？此操作無法復原。`)) {
      return;
    }

    setFileSaving(true);
    setFileError(null);

    try {
      const deletingPath = selectedFile;
      await deleteProjectFile(projectId, deletingPath);
      await refreshProjectFiles();

      if (webPreviewUrl) {
        await deleteFileFromWebContainer(deletingPath, (line) =>
          setWebLogs((current) => [...current, normalizeTerminalLog(line)]),
        );
      }

      setSelectedFile(null);
      setOpenFiles((current) => current.filter((file) => file !== deletingPath));
      setFileContent("");
      setSavedFileContent("");
    } catch (err: unknown) {
      setFileError(err instanceof Error ? err.message : "無法刪除檔案");
    } finally {
      setFileSaving(false);
    }
  }

  async function closeOpenFile(path: string) {
    if (path === selectedFile && fileIsDirty && !window.confirm("目前檔案尚未儲存，確定要關閉嗎？")) {
      return;
    }

    const nextOpenFiles = openFiles.filter((file) => file !== path);
    setOpenFiles(nextOpenFiles);

    if (path !== selectedFile) {
      return;
    }

    const nextFile = nextOpenFiles[nextOpenFiles.length - 1];
    if (nextFile) {
      await openProjectFile(nextFile);
      return;
    }

    setSelectedFile(null);
    setFileContent("");
    setSavedFileContent("");
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
      await refreshDiagnostics();
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

    setEditPreviewLoading(true);
    setEditPreviewError(null);
    setEditPreview(null);

    try {
      const preview = await previewProjectEdit(projectId, editMessage.trim());
      setEditPreview(preview);
    } catch (err: unknown) {
      setEditPreviewError(err instanceof Error ? err.message : "無法產生 Diff Review");
    } finally {
      setEditPreviewLoading(false);
    }
  }

  async function acceptEditPreview() {
    if (!projectId || !editPreview || editPreview.patches.length === 0) {
      return;
    }

    setEditApplyLoading(true);
    setEditPreviewError(null);

    try {
      const response = await applyProjectEdit(
        projectId,
        editPreview.patches.map((patch) => ({ path: patch.path, content: patch.content })),
      );
      const changedResponse: ChatResponse = {
        message: response.message,
        reply: editPreview.notes || "已套用 AI 修改。",
        project_id: projectId,
        workspace_path: "",
        files: response.changed_files.map((file) => file.path),
        preview_url: previewUrl,
        build_attempts: result?.build_attempts ?? 0,
        fix_attempts: result?.fix_attempts ?? 0,
        build_log: result?.build_log ?? "",
        warnings: [...(result?.warnings ?? []), ...editPreview.warnings],
        changed_files: response.changed_files,
      };

      setResult(changedResponse);
      setEditMessage("");
      setEditPreview(null);
      await refreshProjectFiles();
      await syncChatResponseToWebContainer(changedResponse);
      await refreshDiagnostics();
    } catch (err: unknown) {
      setEditPreviewError(err instanceof Error ? err.message : "無法套用 AI 修改");
    } finally {
      setEditApplyLoading(false);
    }
  }

  function renderFileTree(nodes: FileTreeNode[], depth = 0): ReactNode {
    return nodes.map((node) => {
      if (node.type === "folder") {
        return (
          <div key={node.path}>
            <div
              className="px-2 py-1.5 font-mono text-xs font-medium text-zinc-500"
              style={{ paddingLeft: `${8 + depth * 12}px` }}
            >
              {node.name}/
            </div>
            {renderFileTree(node.children, depth + 1)}
          </div>
        );
      }

      return (
        <button
          key={node.path}
          type="button"
          onClick={() => void openProjectFile(node.path)}
          className={`block w-full rounded-lg px-2 py-1.5 text-left font-mono text-xs transition ${
            selectedFile === node.path
              ? "bg-zinc-900 text-white"
              : "text-zinc-700 hover:bg-white"
          }`}
          style={{ paddingLeft: `${8 + depth * 12}px` }}
          disabled={fileLoading || fileSaving}
        >
          {node.name}
        </button>
      );
    });
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
                disabled={bootstrapping || loading || editPreviewLoading || editApplyLoading || !projectId || !editMessage.trim()}
                className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
              >
                {editPreviewLoading ? "產生 diff 中..." : "產生 Diff Review"}
              </button>
            </form>
          ) : null}

          {editPreviewError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {editPreviewError}
            </div>
          ) : null}

          {editPreview ? (
            <div className="rounded-xl border border-violet-200 bg-white p-4 text-sm shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-violet-950">Diff Review</p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        editPreview.change_size === "large"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-emerald-100 text-emerald-800"
                      }`}
                    >
                      {editPreview.change_size === "large" ? "大改動，需確認" : "小改動"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">
                    {editPreview.notes || "AI 已產生待審核修改。"}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {editPreview.patches.length} 個檔案，{editPreview.total_diff_lines} 行 diff
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setEditPreview(null)}
                    className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
                    disabled={editApplyLoading}
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => void acceptEditPreview()}
                    className="rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-violet-300"
                    disabled={editApplyLoading || editPreview.patches.length === 0}
                  >
                    {editApplyLoading ? "套用中..." : "Accept & Apply"}
                  </button>
                </div>
              </div>

              {[...editPreview.npm_dependencies, ...editPreview.dev_dependencies].length > 0 ? (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <p className="font-medium">此修改包含 npm dependency 變更，接受前請特別確認。</p>
                  <p className="mt-1 font-mono">
                    {[...editPreview.npm_dependencies, ...editPreview.dev_dependencies].join(", ")}
                  </p>
                </div>
              ) : null}

              <div className="mt-3 space-y-3">
                {editPreview.patches.map((patch) => (
                  <details key={patch.path} open className="overflow-hidden rounded-lg border border-zinc-200">
                    <summary className="cursor-pointer bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-700">
                      {patch.change_type === "added" ? "新增" : "修改"} {patch.path}
                    </summary>
                    <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all bg-zinc-950 p-3 text-xs leading-5 text-zinc-100">
                      {patch.diff || "No textual diff."}
                    </pre>
                  </details>
                ))}
              </div>
            </div>
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
            <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-sm font-medium text-zinc-700">IDE</h2>
                <p className="mt-1 text-xs text-zinc-500">
                  直接查看與修改目前專案檔案。儲存後可再用微調或重新生成更新預覽。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void createNewFile()}
                  className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
                  disabled={!projectId || fileLoading || fileSaving}
                >
                  新增檔案
                </button>
                <button
                  type="button"
                  onClick={() => void renameCurrentFile()}
                  className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
                  disabled={!selectedFile || fileLoading || fileSaving}
                >
                  重新命名
                </button>
                <button
                  type="button"
                  onClick={() => void deleteCurrentFile()}
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:text-red-300"
                  disabled={!selectedFile || fileLoading || fileSaving}
                >
                  刪除
                </button>
                <button
                  type="button"
                  onClick={() => void refreshProjectFiles()}
                  className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
                  disabled={!projectId || fileLoading || fileSaving}
                >
                  重新整理
                </button>
              </div>
            </div>

            {changedFiles.length > 0 ? (
              <div className="border-b border-zinc-200 bg-emerald-50 px-4 py-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-emerald-900">
                      AI 已更新 {changedFiles.length} 個檔案
                    </p>
                    <p className="mt-1 text-xs leading-5 text-emerald-800">
                      這些檔案已儲存在 backend workspace，並同步到 WebContainer 觸發即時預覽。
                    </p>
                  </div>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-emerald-800">
                    {webPreviewUrl ? "Live 已同步" : "等待 Live Preview"}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {changedFiles.map((file) => (
                    <button
                      key={file.path}
                      type="button"
                      onClick={() => void openProjectFile(file.path)}
                      className="rounded-full border border-emerald-200 bg-white px-3 py-1 font-mono text-xs text-emerald-900 transition hover:border-emerald-400 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:text-emerald-300"
                      disabled={fileLoading || fileSaving}
                    >
                      {file.path}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="grid min-h-[360px] overflow-hidden lg:grid-cols-[240px_1fr]">
              <div className="border-b border-zinc-200 bg-zinc-50 lg:border-b-0 lg:border-r">
                <div className="border-b border-zinc-200 p-2">
                  <input
                    value={fileSearch}
                    onChange={(event) => setFileSearch(event.target.value)}
                    className="w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs outline-none ring-zinc-400 focus:ring-2"
                    placeholder="搜尋檔案..."
                    disabled={fileLoading || fileSaving}
                  />
                </div>
                <div className="max-h-[360px] overflow-auto p-2">
                  {fileTree.length > 0 ? (
                    renderFileTree(fileTree)
                  ) : (
                    <p className="px-2 py-3 text-xs leading-5 text-zinc-500">
                      {projectFiles.length > 0 ? "沒有符合搜尋的檔案。" : "尚未找到可編輯檔案。建立專案後會自動載入 template 檔案。"}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex min-h-[360px] flex-col">
                {openFiles.length > 0 ? (
                  <div className="flex gap-1 overflow-x-auto border-b border-zinc-200 bg-zinc-100 px-2 py-1">
                    {openFiles.map((file) => (
                      <div
                        key={file}
                        className={`flex max-w-56 items-center gap-2 rounded-lg px-2 py-1 text-xs ${
                          selectedFile === file
                            ? "bg-white text-zinc-900 shadow-sm"
                            : "text-zinc-600 hover:bg-white/70"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => void openProjectFile(file)}
                          className="truncate font-mono"
                          disabled={fileLoading || fileSaving}
                          title={file}
                        >
                          {file.split("/").pop()}
                          {selectedFile === file && fileIsDirty ? " *" : ""}
                        </button>
                        <button
                          type="button"
                          onClick={() => void closeOpenFile(file)}
                          className="text-zinc-400 hover:text-zinc-900 disabled:text-zinc-300"
                          disabled={fileLoading || fileSaving}
                          aria-label={`關閉 ${file}`}
                        >
                          x
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
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
                  <div className="min-h-[320px] flex-1 overflow-hidden bg-zinc-950">
                    <MonacoEditor
                      key={selectedFile}
                      path={selectedFile}
                      language={languageForFile(selectedFile)}
                      theme="vs-dark"
                      value={fileContent}
                      onChange={(value: string | undefined) => setFileContent(value ?? "")}
                      onMount={(editor: MonacoEditorInstance, monaco: MonacoApi) => {
                        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
                          saveCurrentFileRef.current();
                        });
                      }}
                      options={{
                        automaticLayout: true,
                        fontSize: 13,
                        minimap: { enabled: false },
                        readOnly: fileLoading || fileSaving,
                        scrollBeyondLastLine: false,
                        tabSize: 2,
                        wordWrap: "on",
                      }}
                    />
                  </div>
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

          {hasBuildDiagnostics ? (
            <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-medium text-zinc-700">Build Diagnostics</h2>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        diagnostics?.status === "passed"
                          ? "bg-emerald-100 text-emerald-800"
                          : diagnostics?.status === "failed"
                            ? "bg-red-100 text-red-700"
                            : "bg-zinc-100 text-zinc-500"
                      }`}
                    >
                      {diagnostics?.status ?? "idle"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">
                    後端 production build 的可信驗證結果。Live Preview 會先更新，這裡用來確認可正式輸出。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void runBackendBuild()}
                  className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
                  disabled={!projectId || diagnosticsLoading}
                >
                  {diagnosticsLoading ? "驗證中..." : "重新驗證"}
                </button>
              </div>
              <div className="space-y-3 p-4 text-sm">
                {diagnosticsError ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {diagnosticsError}
                  </div>
                ) : null}
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
                    <p className="text-xs text-zinc-500">Build attempts</p>
                    <p className="mt-1 font-mono text-zinc-900">{result?.build_attempts ?? 0}</p>
                  </div>
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
                    <p className="text-xs text-zinc-500">TypeScript errors</p>
                    <p className="mt-1 font-mono text-zinc-900">{diagnostics?.typescript_errors.length ?? 0}</p>
                  </div>
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
                    <p className="text-xs text-zinc-500">Warnings</p>
                    <p className="mt-1 font-mono text-zinc-900">{diagnostics?.warnings.length ?? result?.warnings.length ?? 0}</p>
                  </div>
                </div>

                {diagnostics?.typescript_errors.length ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                    <p className="font-medium">TypeScript 錯誤</p>
                    <ul className="mt-2 space-y-1">
                      {diagnostics.typescript_errors.map((item) => (
                        <li key={`${item.file}-${item.line}-${item.col}-${item.code}`}>
                          <span className="font-mono">
                            {item.file}:{item.line}:{item.col} TS{item.code}
                          </span>
                          {" "}
                          {item.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {(diagnostics?.build_log || result?.build_log) ? (
                  <details className="rounded-lg border border-zinc-200 bg-zinc-950">
                    <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-zinc-100">
                      查看 build log
                    </summary>
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all px-3 pb-3 text-xs leading-5 text-zinc-100">
                      {diagnostics?.build_log || result?.build_log}
                    </pre>
                  </details>
                ) : (
                  <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
                    目前沒有 build log。
                  </p>
                )}
              </div>
            </div>
          ) : null}

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

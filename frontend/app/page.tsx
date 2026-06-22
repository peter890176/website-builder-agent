"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";

import { ExportDeployPanel } from "@/components/ExportDeployPanel";
import { HistoryPanel } from "@/components/HistoryPanel";
import { JobPanel } from "@/components/JobPanel";
import { TerminalPanel } from "@/components/TerminalPanel";
import {
  applyProjectEdit,
  createSnapshot,
  createProjectFile,
  createProject,
  deleteProjectFile,
  getProjectDiagnostics,
  listProjectFiles,
  previewProjectEdit,
  readProjectFile,
  renameProjectFile,
  resolvePreviewUrl,
  runProjectVerify,
  saveProjectFile,
  sendChatDraft,
  type ChatResponse,
  type ProjectDiagnosticsResponse,
  type ProjectEditPreviewContext,
  type ProjectEditPreviewResponse,
} from "@/lib/api";
import {
  bootViteReactProject,
  deleteFileFromWebContainer,
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
  getSelection: () => MonacoSelection | null;
  getModel: () => MonacoModel | null;
  onDidChangeCursorSelection: (handler: (event: MonacoSelectionEvent) => void) => { dispose: () => void };
};

type MonacoSelection = {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  isEmpty?: () => boolean;
};

type MonacoSelectionEvent = {
  selection: MonacoSelection;
};

type MonacoModel = {
  getValueInRange: (selection: MonacoSelection) => string;
};

type MonacoTypescriptDefaults = {
  setCompilerOptions: (options: {
    jsx: number;
    module: number;
    moduleResolution: number;
    target: number;
    allowNonTsExtensions: boolean;
    allowSyntheticDefaultImports: boolean;
    esModuleInterop: boolean;
    isolatedModules: boolean;
    noEmit: boolean;
    resolveJsonModule: boolean;
    skipLibCheck: boolean;
    strict: boolean;
    noImplicitAny: boolean;
    lib: string[];
  }) => void;
  addExtraLib: (content: string, filePath?: string) => void;
};

type MonacoApi = {
  KeyMod: { CtrlCmd: number };
  KeyCode: { KeyS: number };
  languages: {
    typescript: {
      JsxEmit: { ReactJSX: number };
      ModuleKind: { ESNext: number };
      ModuleResolutionKind: { NodeJs: number };
      ScriptTarget: { ES2020: number };
      typescriptDefaults: MonacoTypescriptDefaults;
      javascriptDefaults: MonacoTypescriptDefaults;
    };
  };
};

const MonacoEditor = dynamic(() => import("@monaco-editor/react").then((mod) => mod.default), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-[320px] flex-1 items-center justify-center bg-zinc-950 text-sm text-zinc-400">
      Loading Monaco Editor...
    </div>
  ),
});

function configureMonacoForReactTs(monaco: MonacoApi) {
  const options = {
    jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    target: monaco.languages.typescript.ScriptTarget.ES2020,
    allowNonTsExtensions: true,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    isolatedModules: true,
    noEmit: true,
    resolveJsonModule: true,
    skipLibCheck: true,
    strict: true,
    noImplicitAny: false,
    lib: ["dom", "dom.iterable", "es2020"],
  };

  monaco.languages.typescript.typescriptDefaults.setCompilerOptions(options);
  monaco.languages.typescript.javascriptDefaults.setCompilerOptions(options);

  const reactProjectTypes = `
declare namespace JSX {
  interface Element {}
  interface ElementClass { render: unknown }
  interface ElementChildrenAttribute { children: unknown }
  interface IntrinsicAttributes {
    key?: string | number;
  }
  interface IntrinsicElements {
    [elemName: string]: Record<string, unknown>;
  }
}

declare module "react/jsx-runtime" {
  export namespace JSX {
    interface Element {}
    interface ElementClass { render: unknown }
    interface ElementChildrenAttribute { children: unknown }
    interface IntrinsicAttributes {
      key?: string | number;
    }
    interface IntrinsicElements {
      [elemName: string]: Record<string, unknown>;
    }
  }

  export function jsx(type: unknown, props: unknown, key?: string): JSX.Element;
  export function jsxs(type: unknown, props: unknown, key?: string): JSX.Element;
  export const Fragment: unknown;
}

declare module "react" {
  export type ReactNode = unknown;
  export type CSSProperties = Record<string, string | number | undefined>;
  export type FormEvent<T = Element> = { preventDefault(): void; currentTarget: T };
  export type ChangeEvent<T = Element> = { target: T; currentTarget: T };
  export type MouseEvent<T = Element> = { target: T; currentTarget: T };
  export const Fragment: unknown;
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
  export function useState<T>(initial: T): [T, (value: T | ((current: T) => T)) => void];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useRef<T>(initial: T): { current: T };
  export function useCallback<T extends (...args: never[]) => unknown>(callback: T, deps: readonly unknown[]): T;
  export function useId(): string;
  export function useReducer<TState, TAction>(
    reducer: (state: TState, action: TAction) => TState,
    initialState: TState,
  ): [TState, (action: TAction) => void];
  export function useContext<T>(context: { Provider: unknown; Consumer: unknown; _currentValue?: T }): T;
  export function useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  const React: {
    Fragment: typeof Fragment;
    useMemo: typeof useMemo;
    useState: typeof useState;
    useEffect: typeof useEffect;
    useRef: typeof useRef;
    useCallback: typeof useCallback;
    useId: typeof useId;
    useReducer: typeof useReducer;
    useContext: typeof useContext;
    useLayoutEffect: typeof useLayoutEffect;
  };
  export default React;
}

declare module "*.json" {
  const value: any;
  export default value;
}
`;

  monaco.languages.typescript.typescriptDefaults.addExtraLib(
    reactProjectTypes,
    "file:///node_modules/@types/react/index.d.ts",
  );
  monaco.languages.typescript.typescriptDefaults.addExtraLib(
    reactProjectTypes,
    "file:///node_modules/@types/react/jsx-runtime.d.ts",
  );
  monaco.languages.typescript.typescriptDefaults.addExtraLib(
    reactProjectTypes,
    "file:///generated-project/types.d.ts",
  );
}

const WEBSITE_TYPE_OPTIONS: PromptOption[] = [
  { label: "Brand Website", description: "Company, studio, personal brand, or consulting service" },
  { label: "SaaS / Product Landing Page", description: "App, AI tool, digital product, or subscription service" },
  { label: "E-commerce / Product Sales Website", description: "Fashion, beauty, food, electronics, or lifestyle goods" },
  { label: "Restaurant / Cafe Website", description: "Restaurant brand, cafe, bar, or dessert shop" },
  { label: "Portfolio / Resume Website", description: "Designer, engineer, photographer, or freelancer" },
  { label: "Event / Course Registration Page", description: "Talk, workshop, online course, or product launch" },
  { label: "Blog / Content Media Website", description: "Knowledge site, travel, food, or technical articles" },
];

const DESIGN_STYLE_OPTIONS = [
  "Modern Minimal",
  "Luxury Editorial",
  "Tech Forward",
  "Warm Lifestyle",
  "Youthful Playful",
  "Professional Trustworthy",
  "Dark Mode",
];

const COLOR_PALETTE_OPTIONS = [
  "Black, White, and Gray Minimal",
  "Dark Background with Purple Accent",
  "White and Blue Tech",
  "Beige and Brown Warm",
  "Pink and Cream Soft",
  "Natural Green",
];

const EDIT_QUICK_ACTIONS = [
  "Fix current errors",
  "Edit the current file",
  "Improve visual design",
  "Refactor this component",
];

const SECTION_OPTIONS = [
  "Hero Section",
  "Navigation Bar",
  "Services / Feature Overview",
  "Product / Portfolio Cards",
  "Pricing Plans",
  "Testimonials",
  "FAQ",
  "Contact Form",
  "Map / Address Information",
  "Footer",
];

const DEFAULT_SECTIONS = [
  "Hero Section",
  "Navigation Bar",
  "Services / Feature Overview",
  "Testimonials",
  "Contact Form",
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

function selectionRangeLabel(selection: MonacoSelection | null): string {
  if (!selection) {
    return "";
  }
  return `${selection.startLineNumber}:${selection.startColumn}-${selection.endLineNumber}:${selection.endColumn}`;
}

function buildDiagnosticsSummary(diagnostics: ProjectDiagnosticsResponse | null): string {
  if (!diagnostics) {
    return "";
  }

  const lines = [
    `status: ${diagnostics.status}`,
    ...diagnostics.typescript_errors.slice(0, 8).map((item) =>
      `${item.file}:${item.line}:${item.col} TS${item.code} ${item.message}`
    ),
    ...diagnostics.runtime_errors.slice(0, 5).map((item) => `runtime: ${item}`),
    ...diagnostics.notes.slice(0, 5).map((item) => `note: ${item}`),
  ];

  if (diagnostics.build_log && diagnostics.status === "failed") {
    lines.push(`build_log: ${diagnostics.build_log.slice(0, 1200)}`);
  }

  return lines.join("\n");
}

function verificationStatusLabel(status: ProjectDiagnosticsResponse["status"]): string {
  if (status === "live_unverified") {
    return "Live Unverified";
  }
  if (status === "verifying") {
    return "Verifying";
  }
  if (status === "passed") {
    return "Verified";
  }
  if (status === "failed") {
    return "Failed";
  }
  if (status === "drafting") {
    return "Drafting";
  }
  return "Idle";
}

function verificationStatusClass(status: ProjectDiagnosticsResponse["status"]): string {
  if (status === "passed") {
    return "bg-emerald-100 text-emerald-800";
  }
  if (status === "failed") {
    return "bg-red-100 text-red-700";
  }
  if (status === "live_unverified") {
    return "bg-sky-100 text-sky-800";
  }
  if (status === "verifying" || status === "drafting") {
    return "bg-amber-100 text-amber-800";
  }
  return "bg-zinc-100 text-zinc-500";
}

function editAgentStatusLabel(status: "idle" | "editing" | "review" | "applying" | "verifying" | "needs_attention"): string {
  if (status === "editing") {
    return "Editing";
  }
  if (status === "review") {
    return "Review Changes";
  }
  if (status === "applying") {
    return "Applying";
  }
  if (status === "verifying") {
    return "Verifying";
  }
  if (status === "needs_attention") {
    return "Needs Attention";
  }
  return "Ready";
}

function editAgentStatusClass(status: "idle" | "editing" | "review" | "applying" | "verifying" | "needs_attention"): string {
  if (status === "needs_attention") {
    return "bg-red-100 text-red-700";
  }
  if (status === "idle") {
    return "bg-zinc-100 text-zinc-500";
  }
  if (status === "review") {
    return "bg-violet-100 text-violet-800";
  }
  return "bg-amber-100 text-amber-800";
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
    `Create a ${websiteType}.`,
    `Use the ${designStyle} design style with the ${colorPalette} color palette.`,
    `The website must include: ${sections.join(", ")}.`,
  ];

  if (cta) {
    promptLines.push(`The primary CTA is: ${cta}.`);
  }

  if (customDetails) {
    promptLines.push(`Additional custom requirements: ${customDetails}`);
  }

  promptLines.push(
    "Use a multi-file React component architecture and split major sections into maintainable components.",
    "Keep design tokens, spacing, typography, radius, and interaction states consistent across sections.",
    "Support responsive design: desktop may use multi-column layouts, while mobile must be single-column without horizontal scrolling.",
    "If real images, videos, maps, pricing, business hours, or facts are missing, use clearly labeled placeholders such as \"To be provided\". Do not invent facts or reference missing local assets.",
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
  const [cta, setCta] = useState("Contact Us");
  const [customDetails, setCustomDetails] = useState("");
  const [reviewingPrompt, setReviewingPrompt] = useState(false);
  const [editMessage, setEditMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingHint, setLoadingHint] = useState("Generating...");
  const [bootstrapping, setBootstrapping] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ChatResponse | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [projectFiles, setProjectFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [fileSearch, setFileSearch] = useState("");
  const [selectedContextFiles, setSelectedContextFiles] = useState<string[]>([]);
  const [includeCurrentFile, setIncludeCurrentFile] = useState(true);
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [fileContent, setFileContent] = useState("");
  const [savedFileContent, setSavedFileContent] = useState("");
  const [selectedEditorText, setSelectedEditorText] = useState("");
  const [selectedEditorRange, setSelectedEditorRange] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [fileSaving, setFileSaving] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [webPreviewUrl, setWebPreviewUrl] = useState<string | null>(null);
  const [, setWebLogs] = useState<string[]>([]);
  const [webBooting, setWebBooting] = useState(false);
  const [webError, setWebError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<ProjectDiagnosticsResponse | null>(null);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  const [editPreview, setEditPreview] = useState<ProjectEditPreviewResponse | null>(null);
  const [editPreviewLoading, setEditPreviewLoading] = useState(false);
  const [editApplyLoading, setEditApplyLoading] = useState(false);
  const [editPreviewError, setEditPreviewError] = useState<string | null>(null);
  const [editAgentStatus, setEditAgentStatus] = useState<"idle" | "editing" | "review" | "applying" | "verifying" | "needs_attention">("idle");
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [activeToolTab, setActiveToolTab] = useState<"problems" | "logs" | "terminal" | "jobs">("jobs");
  const [exportDeployOpen, setExportDeployOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const saveCurrentFileRef = useRef<() => void>(() => {});
  const monacoEditorRef = useRef<MonacoEditorInstance | null>(null);
  const autoLiveProjectRef = useRef<string | null>(null);

  const fileIsDirty = selectedFile !== null && fileContent !== savedFileContent;
  const activePreviewUrl = webPreviewUrl ?? previewUrl;
  const previewSource = webPreviewUrl ? "live" : previewUrl ? "verified" : "none";
  const verificationStatus = verifyLoading ? "verifying" : diagnostics?.status ?? "idle";
  const changedFiles = result?.changed_files ?? [];
  const filteredProjectFiles = useMemo(() => {
    const query = fileSearch.trim().toLowerCase();
    if (!query) {
      return projectFiles;
    }
    return projectFiles.filter((file) => file.toLowerCase().includes(query));
  }, [fileSearch, projectFiles]);
  const selectedContextSet = useMemo(() => new Set(selectedContextFiles), [selectedContextFiles]);
  const activeContextFiles = useMemo(() => {
    const files = new Set(selectedContextFiles.filter((file) => projectFiles.includes(file)));
    if (includeCurrentFile && selectedFile) {
      files.add(selectedFile);
    }
    return [...files].sort();
  }, [includeCurrentFile, projectFiles, selectedContextFiles, selectedFile]);
  const fileTree = useMemo(() => buildFileTree(filteredProjectFiles), [filteredProjectFiles]);
  const problemCount = (
    (diagnostics?.typescript_errors.length ?? 0)
    + (diagnostics?.runtime_errors.length ?? 0)
    + (diagnostics?.warnings.length ?? result?.warnings.length ?? 0)
    + (diagnosticsError ? 1 : 0)
    + (diagnostics?.status === "failed" && !(diagnostics?.typescript_errors.length || diagnostics?.runtime_errors.length) ? 1 : 0)
  );
  const hasBuildLog = Boolean(diagnostics?.build_log || result?.build_log);

  const finalPrompt = useMemo(() => {
    const selectedSections = [...sections, ...splitCustomItems(customSections)];

    return buildWebsitePrompt({
      websiteType: customWebsiteType.trim() || websiteType,
      designStyle: customDesignStyle.trim() || designStyle,
      colorPalette: customColorPalette.trim() || colorPalette,
      sections: selectedSections.length > 0 ? selectedSections : ["Hero Section", "Footer"],
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
          setError(err instanceof Error ? err.message : "Unable to create project");
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
        setLoadingHint("Planning files and generating code...");
      } else if (elapsed < 120) {
        setLoadingHint("Syncing files and running production build...");
      } else {
        setLoadingHint("Auto-repairing and retrying if the build fails...");
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
      setFileError(err instanceof Error ? err.message : "Unable to load file list");
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
      if (nextDiagnostics.status === "failed") {
        setActiveToolTab("problems");
      }
    } catch (err: unknown) {
      setDiagnosticsError(err instanceof Error ? err.message : "Unable to load diagnostics");
      setActiveToolTab("problems");
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

    if (fileIsDirty && !window.confirm("The current file has unsaved changes. Switch files anyway?")) {
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
      setSelectedEditorText("");
      setSelectedEditorRange("");
    } catch (err: unknown) {
      setFileError(err instanceof Error ? err.message : "Unable to read file");
    } finally {
      setFileLoading(false);
    }
  }

  const startLivePreview = useCallback(async () => {
    setWebBooting(true);
    setWebError(null);
    setWebLogs([]);

    try {
      await bootViteReactProject({
        onLog: (line) => setWebLogs((current) => [...current, normalizeTerminalLog(line)]),
        onServerReady: (url) => setWebPreviewUrl(url),
      });
    } catch (err: unknown) {
      setWebError(err instanceof Error ? err.message : "Live Preview failed to start");
    } finally {
      setWebBooting(false);
    }
  }, []);

  useEffect(() => {
    if (!projectId || autoLiveProjectRef.current === projectId) {
      return;
    }
    autoLiveProjectRef.current = projectId;
    const timer = window.setTimeout(() => {
      void startLivePreview();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [projectId, startLivePreview]);

  useEffect(() => {
    if (!historyOpen && !exportDeployOpen) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [exportDeployOpen, historyOpen]);

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

      await writeFilesToWebContainer(
        [{ path: selectedFile, content: fileContent }],
        {
          onLog: (line) => setWebLogs((current) => [...current, normalizeTerminalLog(line)]),
          onServerReady: (url) => setWebPreviewUrl(url),
        },
      );
    } catch (err: unknown) {
      setFileError(err instanceof Error ? err.message : "Unable to save file");
    } finally {
      setFileSaving(false);
    }
  }, [fileContent, projectId, refreshProjectFiles, selectedFile]);

  useEffect(() => {
    saveCurrentFileRef.current = () => {
      if (selectedFile && fileIsDirty && !fileSaving && !fileLoading) {
        void saveCurrentFile();
      }
    };
  }, [fileIsDirty, fileLoading, fileSaving, saveCurrentFile, selectedFile]);

  async function runBackendVerify(): Promise<ProjectDiagnosticsResponse | null> {
    if (!projectId) {
      return null;
    }

    setVerifyLoading(true);
    setDiagnosticsError(null);
    setDiagnostics((current) =>
      current
        ? { ...current, status: "verifying" }
        : {
            project_id: projectId,
            status: "verifying",
            build_log: "",
            typescript_errors: [],
            runtime_errors: [],
            warnings: [],
            changed_files: [],
            notes: [],
            preview_url: null,
            updated_at: null,
          },
    );

    try {
      const nextDiagnostics = await runProjectVerify(projectId);
      setDiagnostics(nextDiagnostics);
      if (nextDiagnostics.changed_files.length > 0) {
        const changedResponse: ChatResponse = {
          message: "Lint auto-fix applied",
          reply: nextDiagnostics.notes.join("。"),
          project_id: projectId,
          workspace_path: "",
          files: nextDiagnostics.changed_files.map((file) => file.path),
          preview_url: previewUrl,
          build_attempts: result?.build_attempts ?? 0,
          fix_attempts: result?.fix_attempts ?? 0,
          build_log: nextDiagnostics.build_log,
          warnings: nextDiagnostics.warnings,
          changed_files: nextDiagnostics.changed_files,
        };
        setResult(changedResponse);
        await refreshProjectFiles();
        await syncChatResponseToWebContainer(changedResponse);
      }
      if (nextDiagnostics.preview_url) {
        const version = previewKey + 1;
        setPreviewKey(version);
        setPreviewUrl(resolvePreviewUrl(nextDiagnostics.preview_url, version));
      }
      if (nextDiagnostics.status === "passed") {
        await createSnapshot(projectId, {
          label: "Verified build",
          kind: "verify",
          prompt: finalPrompt,
          notes: nextDiagnostics.notes.join("。"),
        }).catch(() => undefined);
      } else if (nextDiagnostics.status === "failed") {
        setActiveToolTab("problems");
      }
      return nextDiagnostics;
    } catch (err: unknown) {
      setDiagnosticsError(err instanceof Error ? err.message : "Backend verification failed");
      setDiagnostics((current) => current ? { ...current, status: "failed" } : current);
      setActiveToolTab("problems");
      return null;
    } finally {
      setVerifyLoading(false);
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

    const path = window.prompt("Enter a new file path, for example src/components/Hero.tsx");
    const normalizedPath = path?.trim().replace(/\\/g, "/");
    if (!normalizedPath) {
      return;
    }

    if (fileIsDirty && !window.confirm("The current file has unsaved changes. Creating a new file will switch the editor. Continue?")) {
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

      await writeFilesToWebContainer([{ path: normalizedPath, content }], {
        onLog: (line) => setWebLogs((current) => [...current, normalizeTerminalLog(line)]),
        onServerReady: (url) => setWebPreviewUrl(url),
      });
    } catch (err: unknown) {
      setFileError(err instanceof Error ? err.message : "Unable to create file");
    } finally {
      setFileSaving(false);
    }
  }

  async function renameCurrentFile() {
    if (!projectId || !selectedFile) {
      return;
    }

    const path = window.prompt("Enter the new file path", selectedFile);
    const normalizedPath = path?.trim().replace(/\\/g, "/");
    if (!normalizedPath || normalizedPath === selectedFile) {
      return;
    }

    setFileSaving(true);
    setFileError(null);

    try {
      await renameProjectFile(projectId, selectedFile, normalizedPath);
      await refreshProjectFiles();

      await renameFileInWebContainer(selectedFile, normalizedPath, (line) =>
        setWebLogs((current) => [...current, normalizeTerminalLog(line)]),
      );

      setSelectedFile(normalizedPath);
      setOpenFiles((current) => current.map((file) => file === selectedFile ? normalizedPath : file));
    } catch (err: unknown) {
      setFileError(err instanceof Error ? err.message : "Unable to rename file");
    } finally {
      setFileSaving(false);
    }
  }

  async function deleteCurrentFile() {
    if (!projectId || !selectedFile) {
      return;
    }

    if (!window.confirm(`Delete ${selectedFile}? This cannot be undone.`)) {
      return;
    }

    setFileSaving(true);
    setFileError(null);

    try {
      const deletingPath = selectedFile;
      await deleteProjectFile(projectId, deletingPath);
      await refreshProjectFiles();

      await deleteFileFromWebContainer(deletingPath, (line) =>
        setWebLogs((current) => [...current, normalizeTerminalLog(line)]),
      );

      setSelectedFile(null);
      setOpenFiles((current) => current.filter((file) => file !== deletingPath));
      setFileContent("");
      setSavedFileContent("");
    } catch (err: unknown) {
      setFileError(err instanceof Error ? err.message : "Unable to delete file");
    } finally {
      setFileSaving(false);
    }
  }

  async function closeOpenFile(path: string) {
    if (path === selectedFile && fileIsDirty && !window.confirm("The current file has unsaved changes. Close it anyway?")) {
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
      setWebError(err instanceof Error ? err.message : "Unable to sync files to WebContainer");
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
    setLoadingHint("Generating draft...");
    setError(null);

    try {
      const response = await sendChatDraft(projectId, finalPrompt, "generate");
      setResult(response);
      setEditMessage("");
      setReviewingPrompt(true);
      await refreshProjectFiles();
      await syncChatResponseToWebContainer(response);
      await createSnapshot(projectId, {
        label: "Generated draft",
        kind: "generate",
        prompt: finalPrompt,
        notes: response.reply,
      }).catch(() => undefined);
      await refreshDiagnostics();
      void runBackendVerify();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setLoading(false);
      setLoadingHint("Generating...");
    }
  }

  function toggleContextFile(path: string) {
    setSelectedContextFiles((current) =>
      current.includes(path)
        ? current.filter((file) => file !== path)
        : [...current, path],
    );
  }

  function appendEditQuickAction(action: string) {
    setEditMessage((current) => {
      const prefix = current.trim();
      return prefix ? `${prefix}\n${action}` : action;
    });
  }

  function updateEditorSelection(selection: MonacoSelection | null) {
    const model = monacoEditorRef.current?.getModel();
    if (!selection || !model || selection.isEmpty?.()) {
      setSelectedEditorText("");
      setSelectedEditorRange("");
      return;
    }

    const text = model.getValueInRange(selection);
    setSelectedEditorText(text);
    setSelectedEditorRange(selectionRangeLabel(selection));
  }

  function buildEditPreviewContext(): ProjectEditPreviewContext {
    return {
      context_files: activeContextFiles,
      current_file: includeCurrentFile ? selectedFile : null,
      selected_text: selectedEditorText,
      selected_range: selectedEditorRange,
      diagnostics_summary: includeDiagnostics ? buildDiagnosticsSummary(diagnostics) : "",
    };
  }

  async function requestEditPreview(message: string) {
    if (!projectId || !message.trim()) {
      return;
    }

    setEditAgentStatus("editing");
    setEditPreviewLoading(true);
    setEditPreviewError(null);
    setEditPreview(null);

    try {
      const preview = await previewProjectEdit(projectId, message.trim(), buildEditPreviewContext());
      setEditPreview(preview);
      setEditAgentStatus("review");
    } catch (err: unknown) {
      setEditAgentStatus("needs_attention");
      setEditPreviewError(err instanceof Error ? err.message : "Unable to create Diff Review");
    } finally {
      setEditPreviewLoading(false);
    }
  }

  async function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await requestEditPreview(editMessage);
  }

  async function requestInlineEditPreview() {
    const message = editMessage.trim()
      || "Make the smallest necessary change to the selected code only, and keep the full file buildable.";
    await requestEditPreview(message);
  }

  async function acceptEditPreview() {
    if (!projectId || !editPreview || editPreview.patches.length === 0) {
      return;
    }

    setEditApplyLoading(true);
    setEditPreviewError(null);
    setEditAgentStatus("applying");

    try {
      const response = await applyProjectEdit(
        projectId,
        editPreview.patches.map((patch) => ({ path: patch.path, content: patch.content })),
      );
      const changedResponse: ChatResponse = {
        message: response.message,
        reply: editPreview.notes || "AI changes applied.",
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
      await createSnapshot(projectId, {
        label: "AI edit applied",
        kind: "edit",
        prompt: editMessage,
        notes: editPreview.notes,
      }).catch(() => undefined);
      setDiagnostics((current) =>
        current
          ? { ...current, status: "live_unverified" }
          : {
              project_id: projectId,
              status: "live_unverified",
              build_log: "",
              typescript_errors: [],
              runtime_errors: [],
              warnings: editPreview.warnings,
              changed_files: response.changed_files,
              notes: [],
              preview_url: null,
              updated_at: null,
            },
      );
      setEditAgentStatus("verifying");
      const verified = await runBackendVerify();
      setEditAgentStatus(verified?.status === "failed" ? "needs_attention" : "idle");
    } catch (err: unknown) {
      setEditAgentStatus("needs_attention");
      setEditPreviewError(err instanceof Error ? err.message : "Unable to apply AI changes");
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
        <div
          key={node.path}
          className={`flex items-center gap-1 rounded-lg pr-2 transition ${
            selectedFile === node.path ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-white"
          }`}
          style={{ paddingLeft: `${8 + depth * 12}px` }}
        >
          <input
            type="checkbox"
            checked={selectedContextSet.has(node.path)}
            onChange={() => toggleContextFile(node.path)}
            className="h-3 w-3 rounded border-zinc-300"
            aria-label={`Add ${node.path} to AI context`}
            disabled={fileLoading || fileSaving}
          />
          <button
            type="button"
            onClick={() => void openProjectFile(node.path)}
            className="min-w-0 flex-1 truncate py-1.5 text-left font-mono text-xs"
            disabled={fileLoading || fileSaving}
          >
            {node.name}
          </button>
        </div>
      );
    });
  }

  return (
    <div className="min-h-full bg-zinc-50 text-zinc-900">
      <div className="mx-auto flex min-h-full max-w-[1800px] flex-col gap-6 px-4 py-8 lg:flex-row">
        <section className="flex w-full flex-col gap-4 overflow-auto lg:w-[520px] lg:min-w-[360px] lg:max-w-[760px] lg:shrink-0 lg:resize-x">
          <div>
            <p className="text-sm font-medium text-zinc-500">website-builder-agent</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              AI Website Builder
            </h1>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              Choose the website type, style, color palette, and sections, then review the full prompt before sending it to the agent.
            </p>
            <p className="mt-1 hidden text-xs text-zinc-400 lg:block">
              Drag the side panel, file tree, and editor edges to resize the workspace.
            </p>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm">
            <p className="font-medium text-zinc-700">Project ID</p>
            <p className="mt-1 break-all font-mono text-zinc-900">
              {bootstrapping ? "Creating..." : projectId ?? "—"}
            </p>
          </div>

          <form onSubmit={handleBuilderSubmit} className="flex flex-col gap-3">
            <div>
              <p className="text-sm font-medium text-zinc-700">Website Prompt</p>
              <p className="mt-1 text-xs leading-5 text-zinc-500">
                The full website requirements stay here. You can revise the options and regenerate, which replaces the current preview.
              </p>
            </div>
                <div className="rounded-xl border border-zinc-200 bg-white p-4">
                  <label htmlFor="websiteType" className="text-sm font-medium text-zinc-700">
                    Website Type
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
                    placeholder="Or enter a custom website type, for example: clinic booking website"
                    disabled={bootstrapping || loading || !projectId}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-zinc-200 bg-white p-4">
                    <label htmlFor="designStyle" className="text-sm font-medium text-zinc-700">
                      Design Style
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
                      placeholder="Or enter a custom style"
                      disabled={bootstrapping || loading || !projectId}
                    />
                  </div>

                  <div className="rounded-xl border border-zinc-200 bg-white p-4">
                    <label htmlFor="colorPalette" className="text-sm font-medium text-zinc-700">
                      Color Palette
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
                      placeholder="Or enter a custom color palette"
                      disabled={bootstrapping || loading || !projectId}
                    />
                  </div>
                </div>

                <div className="rounded-xl border border-zinc-200 bg-white p-4">
                  <p className="text-sm font-medium text-zinc-700">Main Sections</p>
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
                    placeholder="Other sections, separated by commas or new lines, for example: timeline, team"
                    disabled={bootstrapping || loading || !projectId}
                  />
                </div>

                <div className="rounded-xl border border-zinc-200 bg-white p-4">
                  <label htmlFor="cta" className="text-sm font-medium text-zinc-700">
                    CTA and Custom Content
                  </label>
                  <input
                    id="cta"
                    value={cta}
                    onChange={(event) => updateDraft(() => setCta(event.target.value))}
                    className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:ring-2"
                    placeholder="For example: Book a Demo, Reserve Now, View Work"
                    disabled={bootstrapping || loading || !projectId}
                  />
                  <textarea
                    value={customDetails}
                    onChange={(event) => updateDraft(() => setCustomDetails(event.target.value))}
                    rows={4}
                    className="mt-3 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm leading-6 outline-none ring-zinc-400 focus:ring-2"
                    placeholder="Add brand name, target audience, required copy, special features, or data."
                    disabled={bootstrapping || loading || !projectId}
                  />
                </div>

                {reviewingPrompt ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-emerald-900">
                        {result ? "Current Full Prompt" : "Full Prompt to Send to AI"}
                      </p>
                      <button
                        type="button"
                        onClick={() => setReviewingPrompt(false)}
                        className="text-sm text-emerald-800 underline underline-offset-4"
                        disabled={loading}
                      >
                        Edit Prompt
                      </button>
                    </div>
                    <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-xs leading-5 text-zinc-700">
                      {finalPrompt}
                    </pre>
                    {result ? (
                      <p className="mt-3 text-xs leading-5 text-emerald-900">
                        If you change the options and confirm again, the current version will be replaced by a newly generated site.
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
                    ? "Confirm and Regenerate Website"
                    : "Confirm and Generate Website"
                  : "Create Full Prompt"}
            </button>
          </form>

          {result ? (
            <form onSubmit={handleEditSubmit} className="flex flex-col gap-3 rounded-xl border border-violet-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <label htmlFor="editPrompt" className="text-sm font-medium text-violet-950">
                    AI Edit Composer
                  </label>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">
                    Describe edits like Cursor, choose context, then generate a Diff Review before applying changes.
                  </p>
                </div>
                <span className={`w-fit rounded-full px-2 py-0.5 text-xs font-medium ${editAgentStatusClass(editAgentStatus)}`}>
                  {editAgentStatusLabel(editAgentStatus)}
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                {EDIT_QUICK_ACTIONS.map((action) => (
                  <button
                    key={action}
                    type="button"
                    onClick={() => appendEditQuickAction(action)}
                    className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-800 transition hover:bg-violet-100"
                    disabled={bootstrapping || loading || editPreviewLoading || editApplyLoading || !projectId}
                  >
                    {action}
                  </button>
                ))}
              </div>

              <textarea
                id="editPrompt"
                rows={5}
                value={editMessage}
                onChange={(event) => setEditMessage(event.target.value)}
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm leading-6 outline-none ring-violet-400 focus:ring-2"
                placeholder="For example: strengthen the Hero CTA and only modify the current file"
                disabled={bootstrapping || loading || !projectId}
              />

              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
                <div className="flex flex-wrap gap-3">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={includeCurrentFile}
                      onChange={(event) => setIncludeCurrentFile(event.target.checked)}
                    />
                    Include current file{selectedFile ? `: ${selectedFile}` : ""}
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={includeDiagnostics}
                      onChange={(event) => setIncludeDiagnostics(event.target.checked)}
                    />
                    Include Build Diagnostics
                  </label>
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  {activeContextFiles.length > 0 ? (
                    activeContextFiles.map((file) => (
                      <span key={file} className="rounded-full bg-white px-2 py-0.5 font-mono text-[11px] text-zinc-700">
                        {file}
                      </span>
                    ))
                  ) : (
                    <span>No context selected. The AI will use the current project content.</span>
                  )}
                </div>

                {selectedEditorText ? (
                  <p className="mt-2 font-mono text-[11px] text-violet-700">
                    Selected {selectedFile} #{selectedEditorRange}. You can run an inline edit.
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => void requestInlineEditPreview()}
                  disabled={
                    bootstrapping
                    || loading
                    || editPreviewLoading
                    || editApplyLoading
                    || !projectId
                    || !selectedEditorText
                  }
                  className="rounded-xl border border-violet-200 px-4 py-2.5 text-sm font-medium text-violet-800 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:text-violet-300"
                >
                  Edit Selection with AI
                </button>
                <button
                  type="submit"
                  disabled={bootstrapping || loading || editPreviewLoading || editApplyLoading || !projectId || !editMessage.trim()}
                  className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400 sm:flex-1"
                >
                  {editPreviewLoading ? "Generating diff..." : "Generate Diff Review"}
                </button>
              </div>
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
                      {editPreview.change_size === "large" ? "Large change, confirmation required" : "Small change"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">
                    {editPreview.notes || "AI generated changes for review."}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {editPreview.patches.length} files, {editPreview.total_diff_lines} diff lines
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
                    {editApplyLoading ? "Applying..." : "Accept & Apply"}
                  </button>
                </div>
              </div>

              {[...editPreview.npm_dependencies, ...editPreview.dev_dependencies].length > 0 ? (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <p className="font-medium">This change includes npm dependency changes. Review carefully before accepting.</p>
                  <p className="mt-1 font-mono">
                    {[...editPreview.npm_dependencies, ...editPreview.dev_dependencies].join(", ")}
                  </p>
                </div>
              ) : null}

              <div className="mt-3 space-y-3">
                {editPreview.patches.map((patch) => (
                  <details key={patch.path} open className="overflow-hidden rounded-lg border border-zinc-200">
                    <summary className="cursor-pointer bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-700">
                      {patch.change_type === "added" ? "Added" : "Modified"} {patch.path}
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
              Keep the backend terminal running and watch the uvicorn logs for npm install and build progress.
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
                  Auto-repaired {result.fix_attempts} times
                  {result.build_attempts > 0
                    ? `, succeeded after ${result.build_attempts} build attempts`
                    : ""}
                </p>
              ) : null}
              {result.warnings.length > 0 ? (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                  <p className="font-medium">Information / Asset Warnings</p>
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
          <div className="order-0 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
              disabled={!projectId}
            >
              Version History
            </button>
            <button
              type="button"
              onClick={() => setExportDeployOpen(true)}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
              disabled={!projectId}
            >
              Export / Deploy
            </button>
          </div>

          <div className="order-2 rounded-xl border border-zinc-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-sm font-medium text-zinc-700">IDE</h2>
                <p className="mt-1 text-xs text-zinc-500">
                  View and edit project files directly. Save changes, then refine or regenerate the preview.
                </p>
                <p className="mt-1 hidden text-xs text-zinc-400 lg:block">
                  The file tree and editor can be resized by dragging.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void createNewFile()}
                  className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
                  disabled={!projectId || fileLoading || fileSaving}
                >
                  New File
                </button>
                <button
                  type="button"
                  onClick={() => void renameCurrentFile()}
                  className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
                  disabled={!selectedFile || fileLoading || fileSaving}
                >
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => void deleteCurrentFile()}
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:text-red-300"
                  disabled={!selectedFile || fileLoading || fileSaving}
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => void refreshProjectFiles()}
                  className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
                  disabled={!projectId || fileLoading || fileSaving}
                >
                  Refresh
                </button>
              </div>
            </div>

            {changedFiles.length > 0 ? (
              <div className="border-b border-zinc-200 bg-emerald-50 px-4 py-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-emerald-900">
                      AI updated {changedFiles.length} files
                    </p>
                    <p className="mt-1 text-xs leading-5 text-emerald-800">
                      These files were saved to the backend workspace and synced to WebContainer for live preview.
                    </p>
                  </div>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-emerald-800">
                    {webPreviewUrl ? "Live Synced" : "Waiting for Live Preview"}
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

            <div className="flex min-h-[360px] flex-col overflow-hidden lg:flex-row">
              <div className="border-b border-zinc-200 bg-zinc-50 lg:w-[240px] lg:min-w-[180px] lg:max-w-[480px] lg:resize-x lg:overflow-auto lg:border-b-0 lg:border-r">
                <div className="border-b border-zinc-200 p-2">
                  <input
                    value={fileSearch}
                    onChange={(event) => setFileSearch(event.target.value)}
                    className="w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs outline-none ring-zinc-400 focus:ring-2"
                    placeholder="Search files..."
                    disabled={fileLoading || fileSaving}
                  />
                </div>
                <div className="max-h-[360px] overflow-auto p-2">
                  {fileTree.length > 0 ? (
                    renderFileTree(fileTree)
                  ) : (
                    <p className="px-2 py-3 text-xs leading-5 text-zinc-500">
                      {projectFiles.length > 0 ? "No files match the search." : "No editable files found yet. Template files load automatically after project creation."}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex min-h-[360px] min-w-0 flex-1 flex-col">
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
                          aria-label={`Close ${file}`}
                        >
                          x
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="flex flex-col gap-2 border-b border-zinc-200 px-4 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="break-all font-mono text-xs text-zinc-600">
                      {selectedFile ?? "No file selected"}
                    </p>
                    {fileIsDirty ? (
                      <p className="mt-1 text-xs font-medium text-amber-700">
                        Unsaved changes. Press Ctrl/Cmd + S to save.
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => void saveCurrentFile()}
                    className="w-full shrink-0 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400 sm:w-auto"
                    disabled={!selectedFile || !fileIsDirty || fileLoading || fileSaving}
                  >
                    {fileSaving ? "Saving..." : "Save File"}
                  </button>
                </div>

                {selectedFile ? (
                  <div className="min-h-[320px] flex-1 resize-y overflow-hidden bg-zinc-950">
                    <MonacoEditor
                      key={selectedFile}
                      path={selectedFile}
                      language={languageForFile(selectedFile)}
                      theme="vs-dark"
                      value={fileContent}
                      onChange={(value: string | undefined) => setFileContent(value ?? "")}
                      onMount={(editor: MonacoEditorInstance, monaco: MonacoApi) => {
                        configureMonacoForReactTs(monaco);
                        monacoEditorRef.current = editor;
                        updateEditorSelection(editor.getSelection());
                        editor.onDidChangeCursorSelection((event) => {
                          updateEditorSelection(event.selection);
                        });
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
                    Select a file from the left to start editing.
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

          <div className="order-3 rounded-xl border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-200 px-4 py-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-medium text-zinc-700">Workspace Tools</h2>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${verificationStatusClass(verificationStatus)}`}>
                    {verificationStatusLabel(verificationStatus)}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  Jobs show current progress. Switch to Problems, Build Logs, or Terminal when needed.
                </p>
              </div>
            </div>

            <div className="border-b border-zinc-200 px-3 pt-3">
              <div className="flex flex-wrap gap-2">
                {[
                  { id: "jobs", label: "Jobs", badge: 0 },
                  { id: "problems", label: "Problems", badge: problemCount },
                  { id: "logs", label: "Build Logs", badge: hasBuildLog ? 1 : 0 },
                  { id: "terminal", label: "Terminal", badge: 0 },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveToolTab(tab.id as "problems" | "logs" | "terminal" | "jobs")}
                    className={`rounded-t-lg px-3 py-2 text-xs font-medium ${
                      activeToolTab === tab.id
                        ? "border border-b-white border-zinc-200 bg-white text-zinc-900"
                        : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900"
                    }`}
                  >
                    {tab.label}
                    {tab.badge > 0 ? (
                      <span className="ml-2 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] text-red-700">
                        {tab.badge}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-52 p-4 text-sm">
              {activeToolTab === "problems" ? (
                <div className="space-y-3">
                  <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs leading-5 text-zinc-600">
                      Verification runs automatically after AI generation, AI edits, and restores. Re-run it here after manual edits or before deploy.
                    </p>
                    <button
                      type="button"
                      onClick={() => void runBackendVerify()}
                      className="shrink-0 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-400"
                      disabled={!projectId || verifyLoading}
                    >
                      {verifyLoading ? "Verifying..." : "Re-run Verify"}
                    </button>
                  </div>
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

                  {diagnostics?.status === "failed" && !(diagnostics.typescript_errors.length || diagnostics.runtime_errors.length || diagnosticsError) ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                      Backend verify failed. Open Build Logs for details.
                    </div>
                  ) : null}

                  {diagnostics?.typescript_errors.length ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                      <p className="font-medium">TypeScript Errors</p>
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

                  {diagnostics?.runtime_errors.length ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                      <p className="font-medium">Runtime errors</p>
                      <ul className="mt-2 space-y-1">
                        {diagnostics.runtime_errors.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {(diagnostics?.warnings.length ?? result?.warnings.length ?? 0) > 0 ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      <p className="font-medium">Warnings</p>
                      <ul className="mt-2 space-y-1">
                        {(diagnostics?.warnings ?? result?.warnings ?? []).map((warning, index) => (
                          <li key={`${warning.kind}-${index}`}>{warning.message}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {problemCount === 0 ? (
                    <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
                      No problems found.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {activeToolTab === "logs" ? (
                hasBuildLog ? (
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-zinc-950 p-3 text-xs leading-5 text-zinc-100">
                    {diagnostics?.build_log || result?.build_log}
                  </pre>
                ) : (
                  <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
                    No build log yet.
                  </p>
                )
              ) : null}

              {activeToolTab === "terminal" ? (
                <TerminalPanel
                  projectId={projectId}
                  compact
                  onServerReady={(url) => setWebPreviewUrl(url)}
                />
              ) : null}

              {activeToolTab === "jobs" ? (
                <JobPanel projectId={projectId} compact />
              ) : null}
            </div>
          </div>

          <div className="order-1 flex flex-1 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-medium text-zinc-700">Preview</h2>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      activePreviewUrl ? verificationStatusClass(verificationStatus) : "bg-zinc-100 text-zinc-500"
                    }`}
                  >
                    {webPreviewUrl ? "Live" : webBooting ? "Starting Live" : activePreviewUrl ? verificationStatusLabel(verificationStatus) : "No preview"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  Live Preview starts automatically and syncs file changes. Backend verification only affects deploy readiness.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {activePreviewUrl ? (
                  <a
                    href={activePreviewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50"
                  >
                    Open in New Tab
                  </a>
                ) : null}
              </div>
            </div>

            {webError ? (
              <div className="flex flex-col gap-2 border-b border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 sm:flex-row sm:items-center sm:justify-between">
                <span>{webError}</span>
                <button
                  type="button"
                  onClick={() => void startLivePreview()}
                  className="shrink-0 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:text-red-300"
                  disabled={webBooting}
                >
                  {webBooting ? "Preparing Live..." : "Reconnect Live"}
                </button>
              </div>
            ) : null}

            {loading ? (
              <div className="flex h-full min-h-[70vh] w-full items-center justify-center px-6 text-center text-sm text-zinc-500">
                Generating a new version. The preview will update automatically when ready...
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
                {webBooting ? "Preparing Live Preview..." : "Live Preview starts automatically. The generated website will appear here."}
              </div>
            )}
          </div>
        </section>
      </div>

      {historyOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 px-4 py-6"
          role="dialog"
          aria-modal="true"
          aria-label="Version history"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setHistoryOpen(false);
            }
          }}
        >
          <div className="flex h-[68vh] max-h-[82vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="shrink-0 flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-zinc-900">Version History</h2>
                <p className="mt-1 text-xs text-zinc-500">
                  Create named snapshots, compare versions, or roll back to an earlier state.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50"
              >
                Close
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <HistoryPanel
                projectId={projectId}
                prompt={finalPrompt}
                chrome={false}
                onRestore={async (files) => {
                  const changedResponse: ChatResponse = {
                    message: "Snapshot restored",
                    reply: "Snapshot restored and synced to WebContainer.",
                    project_id: projectId ?? "",
                    workspace_path: "",
                    files: files.map((file) => file.path),
                    preview_url: previewUrl,
                    build_attempts: result?.build_attempts ?? 0,
                    fix_attempts: result?.fix_attempts ?? 0,
                    build_log: result?.build_log ?? "",
                    warnings: result?.warnings ?? [],
                    changed_files: files,
                  };
                  setResult(changedResponse);
                  await refreshProjectFiles();
                  await syncChatResponseToWebContainer(changedResponse);
                  void runBackendVerify();
                }}
              />
            </div>
          </div>
        </div>
      ) : null}

      {exportDeployOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 px-4 py-6"
          role="dialog"
          aria-modal="true"
          aria-label="Export and deploy"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setExportDeployOpen(false);
            }
          }}
        >
          <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-zinc-900">Export / Deploy</h2>
                <p className="mt-1 text-xs text-zinc-500">
                  Download ZIP files, export to GitHub, or deploy to a provider. Deploy availability depends on verified status.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setExportDeployOpen(false)}
                className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50"
              >
                Close
              </button>
            </div>
            <div className="p-4">
              <ExportDeployPanel projectId={projectId} diagnostics={diagnostics} chrome={false} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

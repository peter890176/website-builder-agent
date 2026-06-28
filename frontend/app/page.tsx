"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import * as Accordion from "@radix-ui/react-accordion";
import * as Tabs from "@radix-ui/react-tabs";

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
  deployProject,
  getProjectDiagnostics,
  listProjectFiles,
  listProjects,
  previewProjectEdit,
  readProjectFile,
  readProjectFiles,
  renameProjectFile,
  resolvePreviewUrl,
  runProjectBuild,
  runProjectVerify,
  saveProjectFile,
  sendChatDraft,
  updateProject,
  type ChatResponse,
  type ChatMode,
  type DeploymentRecord,
  type ProjectDiagnosticsResponse,
  type ProjectEditPreviewContext,
  type ProjectEditPreviewResponse,
  type ProjectSummary,
} from "@/lib/api";
import {
  deleteFileFromWebContainer,
  renameFileInWebContainer,
  restoreDefaultWebContainerTemplate,
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

const ACTIVE_PROJECT_STORAGE_KEY = "website-builder-active-project";

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

type DeployProvider = "vercel" | "netlify" | "cloudflare";

type DeployIntent = {
  provider: DeployProvider;
  projectName: string;
};

type PendingDeployIntent = {
  intent: DeployIntent;
  message: string;
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
  { label: "Brand / Company Website", description: "Company, studio, personal brand, or consulting service" },
  { label: "Personal Portfolio", description: "Designer, engineer, photographer, freelancer, or creator" },
  { label: "Landing Page", description: "Single focused campaign, product, or service page" },
  { label: "SaaS Product Website", description: "App, AI tool, digital product, or subscription service" },
  { label: "Clinic / Booking Website", description: "Appointment-based service, clinic, coach, or local provider" },
  { label: "Restaurant Website", description: "Restaurant brand, cafe, bar, dessert shop, or food business" },
  { label: "E-commerce Store", description: "Fashion, beauty, food, electronics, or lifestyle goods" },
  { label: "Blog / Content Website", description: "Knowledge site, travel, food, or technical articles" },
  { label: "Event Website", description: "Talk, workshop, online course, launch, or conference" },
  { label: "Custom", description: "Use your own website type" },
];

const WEBSITE_FORMAT_OPTIONS = [
  "One-page website",
  "Multi-page website",
  "Not sure, let AI decide",
];

const MAIN_OBJECTIVE_OPTIONS = [
  "Get leads",
  "Sell a product",
  "Showcase portfolio",
  "Explain services",
  "Build trust",
  "Collect bookings",
  "Share information",
  "Custom",
];

const TONE_OF_VOICE_OPTIONS = [
  "Professional",
  "Friendly",
  "Premium",
  "Playful",
  "Technical",
  "Minimal",
  "Bold",
  "Custom",
];

const CTA_ACTION_OPTIONS = [
  "Contact Us",
  "Book a Call",
  "Sign Up",
  "Buy Now",
  "Start Free Trial",
  "Download App",
  "View Portfolio",
  "Subscribe",
  "Get a Quote",
  "Custom",
];

const CTA_DESTINATION_OPTIONS = [
  "Contact form section",
  "External link",
  "Pricing section",
  "Booking page",
  "Email",
  "Phone",
  "Custom",
];

const DESIGN_STYLE_OPTIONS = [
  "Modern Minimal",
  "Bold Startup",
  "Luxury Editorial",
  "Friendly & Playful",
  "Tech / SaaS",
  "Professional Corporate",
  "Creative Portfolio",
  "Custom",
];

const COLOR_PALETTE_OPTIONS = [
  "Black, White, and Gray",
  "Blue and White",
  "Warm Neutral",
  "Dark Mode",
  "Pastel",
  "High Contrast",
  "Brand Colors",
  "Custom",
];

const TYPOGRAPHY_VIBE_OPTIONS = [
  "Clean Sans-serif",
  "Elegant Serif",
  "Tech / Futuristic",
  "Friendly Rounded",
  "Let AI decide",
];

const LAYOUT_DENSITY_OPTIONS = [
  "Spacious",
  "Balanced",
  "Compact",
];

const ANIMATION_LEVEL_OPTIONS = [
  "None",
  "Subtle",
  "Moderate",
  "Rich",
];

function detectDeployIntent(message: string): DeployIntent | null {
  const text = message.toLowerCase();
  const wantsDeploy = /\b(deploy|deployment|publish|release|go live|launch)\b/.test(text);
  if (!wantsDeploy) {
    return null;
  }

  const provider: DeployProvider = text.includes("cloudflare")
    ? "cloudflare"
    : text.includes("vercel")
      ? "vercel"
      : "netlify";
  const nameMatch = message.match(/(?:as|named|name|site name|project name)\s+["']?([a-z0-9][a-z0-9-]{2,62})["']?/i);

  return {
    provider,
    projectName: nameMatch?.[1] ?? "",
  };
}

const SECTION_GROUPS = [
  {
    title: "Essential Sections",
    items: ["Navigation Bar", "Hero Section", "Footer"],
  },
  {
    title: "Business Sections",
    items: ["About", "Services", "Products / Portfolio", "Pricing", "Team", "Process / Timeline"],
  },
  {
    title: "Trust & Conversion",
    items: ["Testimonials", "FAQ", "Case Studies", "Client Logos", "CTA Section"],
  },
  {
    title: "Contact",
    items: ["Contact Form", "Map / Address", "Social Links", "Newsletter Signup"],
  },
];

const GUIDED_SECTION_IDS = [
  "websiteGoal",
  "brandAudience",
  "primaryCta",
  "designPreferences",
  "pagesSections",
  "additionalRequirements",
];

const DEFAULT_GUIDED_SECTION = "websiteGoal";
const GUIDED_SELECT_PLACEHOLDER = "Select an option";

type GuidedFieldKey =
  | "websiteType"
  | "customWebsiteType"
  | "websiteFormat"
  | "mainObjective"
  | "customMainObjective"
  | "brandName"
  | "businessDescription"
  | "targetAudience"
  | "toneOfVoice"
  | "customToneOfVoice"
  | "ctaAction"
  | "customCtaAction"
  | "ctaButtonText"
  | "ctaDestination"
  | "customCtaDestination"
  | "ctaLink"
  | "sections"
  | "customSections"
  | "designStyle"
  | "customDesignStyle"
  | "colorPalette"
  | "customColorPalette"
  | "typographyVibe"
  | "layoutDensity"
  | "animationLevel"
  | "referenceWebsites"
  | "requiredCopy"
  | "specialInstructions"
  | "structuredData";

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
    return "bg-cyan-100 text-cyan-800";
  }
  return "bg-amber-100 text-amber-800";
}

function selectedOrCustom(selected: string, custom: string) {
  const trimmed = custom.trim();
  return selected === "Custom" && trimmed ? trimmed : selected;
}

function includeGuidedField(
  touchedFields: ReadonlySet<GuidedFieldKey>,
  key: GuidedFieldKey,
  value: string | string[] | undefined,
): string | string[] | undefined {
  if (!touchedFields.has(key)) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? value : undefined;
  }
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function includeGuidedSelectOrCustom(
  touchedFields: ReadonlySet<GuidedFieldKey>,
  selectKey: GuidedFieldKey,
  customKey: GuidedFieldKey,
  selected: string,
  custom: string,
): string | undefined {
  if (!touchedFields.has(selectKey) && !touchedFields.has(customKey)) {
    return undefined;
  }
  const resolved = selectedOrCustom(selected, custom).trim();
  return resolved || undefined;
}

function appendPromptSection(lines: string[], title: string, entries: Array<[string, string | string[] | undefined]>) {
  const content = entries
    .map(([label, value]) => {
      if (Array.isArray(value)) {
        return value.length > 0 ? `${label}: ${value.join(", ")}` : "";
      }
      const trimmed = value?.trim();
      return trimmed ? `${label}: ${trimmed}` : "";
    })
    .filter(Boolean);

  if (content.length > 0) {
    lines.push(`\n## ${title}`, ...content);
  }
}

const WEBSITE_DESIGN_INSTRUCTION_BLOCK = [
  "\n## Design System Instructions",
  "Use a design-system-first approach. Prefer reusable UI primitives such as Container, Section, SectionHeader, Button, Card, and Badge instead of raw unstructured divs.",
  "Default to a centered hero with a clear headline, supporting copy, and CTA group.",
  "Center section headers by default and keep text in readable max-width containers.",
  "Use max-width page containers, consistent section spacing, responsive grids, and card-based content groups.",
  "Keep card, button, badge, typography, radius, color, border, and shadow rules consistent across the site.",
  "Avoid plain document-style, all-left-aligned pages unless the user explicitly asks for that style.",
  "Make desktop and mobile layouts feel intentional and avoid horizontal overflow.",
];

function buildStructuredWebsitePrompt({
  websiteType,
  customWebsiteType,
  websiteFormat,
  mainObjective,
  customMainObjective,
  brandName,
  businessDescription,
  targetAudience,
  toneOfVoice,
  customToneOfVoice,
  ctaAction,
  customCtaAction,
  ctaButtonText,
  ctaDestination,
  customCtaDestination,
  ctaLink,
  sections,
  customSections,
  designStyle,
  customDesignStyle,
  colorPalette,
  customColorPalette,
  typographyVibe,
  layoutDensity,
  animationLevel,
  referenceWebsites,
  requiredCopy,
  specialInstructions,
  structuredData,
  touchedFields,
}: {
  websiteType: string;
  customWebsiteType: string;
  websiteFormat: string;
  mainObjective: string;
  customMainObjective: string;
  brandName: string;
  businessDescription: string;
  targetAudience: string;
  toneOfVoice: string;
  customToneOfVoice: string;
  ctaAction: string;
  customCtaAction: string;
  ctaButtonText: string;
  ctaDestination: string;
  customCtaDestination: string;
  ctaLink: string;
  sections: string[];
  customSections: string[];
  designStyle: string;
  customDesignStyle: string;
  colorPalette: string;
  customColorPalette: string;
  typographyVibe: string;
  layoutDensity: string;
  animationLevel: string;
  referenceWebsites: string;
  requiredCopy: string;
  specialInstructions: string;
  structuredData: string;
  touchedFields: ReadonlySet<GuidedFieldKey>;
}) {
  const resolvedWebsiteType = includeGuidedSelectOrCustom(
    touchedFields,
    "websiteType",
    "customWebsiteType",
    websiteType,
    customWebsiteType,
  );
  const selectedSections = touchedFields.has("sections") ? sections : [];
  const selectedCustomSections = touchedFields.has("customSections") ? customSections : [];
  const allSections = [...selectedSections, ...selectedCustomSections];
  const lines: string[] = [];

  if (resolvedWebsiteType) {
    lines.push(
      `Create a ${resolvedWebsiteType}.`,
      "Use the structured requirements below to make planning, copywriting, visual design, and implementation decisions.",
    );
  }

  appendPromptSection(lines, "Website Goal", [
    ["Website Type", resolvedWebsiteType],
    ["Website Format", includeGuidedField(touchedFields, "websiteFormat", websiteFormat)],
    ["Main Objective", includeGuidedSelectOrCustom(touchedFields, "mainObjective", "customMainObjective", mainObjective, customMainObjective)],
  ]);
  appendPromptSection(lines, "Brand & Audience", [
    ["Brand / Company Name", includeGuidedField(touchedFields, "brandName", brandName)],
    ["What they do", includeGuidedField(touchedFields, "businessDescription", businessDescription)],
    ["Target Audience", includeGuidedField(touchedFields, "targetAudience", targetAudience)],
    ["Tone of Voice", includeGuidedSelectOrCustom(touchedFields, "toneOfVoice", "customToneOfVoice", toneOfVoice, customToneOfVoice)],
  ]);
  appendPromptSection(lines, "Primary CTA", [
    ["Main Visitor Action", includeGuidedSelectOrCustom(touchedFields, "ctaAction", "customCtaAction", ctaAction, customCtaAction)],
    ["CTA Button Text", includeGuidedField(touchedFields, "ctaButtonText", ctaButtonText)],
    ["CTA Destination", includeGuidedSelectOrCustom(touchedFields, "ctaDestination", "customCtaDestination", ctaDestination, customCtaDestination)],
    ["CTA Link", includeGuidedField(touchedFields, "ctaLink", ctaLink)],
  ]);
  appendPromptSection(lines, "Pages & Sections", [
    ["Selected Sections", allSections.length > 0 ? allSections : undefined],
  ]);
  appendPromptSection(lines, "Design Preferences", [
    ["Design Style", includeGuidedSelectOrCustom(touchedFields, "designStyle", "customDesignStyle", designStyle, customDesignStyle)],
    ["Color Palette", includeGuidedSelectOrCustom(touchedFields, "colorPalette", "customColorPalette", colorPalette, customColorPalette)],
    ["Custom Color Palette", colorPalette !== "Custom" ? includeGuidedField(touchedFields, "customColorPalette", customColorPalette) : undefined],
    ["Typography Vibe", includeGuidedField(touchedFields, "typographyVibe", typographyVibe)],
    ["Layout Density", includeGuidedField(touchedFields, "layoutDensity", layoutDensity)],
    ["Animation Level", includeGuidedField(touchedFields, "animationLevel", animationLevel)],
    ["Reference Websites", includeGuidedField(touchedFields, "referenceWebsites", referenceWebsites)],
  ]);
  appendPromptSection(lines, "Additional Requirements", [
    ["Required Copy / Content", includeGuidedField(touchedFields, "requiredCopy", requiredCopy)],
    ["Special Instructions", includeGuidedField(touchedFields, "specialInstructions", specialInstructions)],
    ["Data / Structured Information", includeGuidedField(touchedFields, "structuredData", structuredData)],
  ]);

  if (lines.length === 0) {
    return "";
  }

  lines.push(
    ...WEBSITE_DESIGN_INSTRUCTION_BLOCK,
    "\n## Generation Instructions",
    "Use a multi-file React component architecture and split major sections into maintainable components.",
    "Keep design tokens, spacing, typography, radius, and interaction states consistent across sections.",
    "Support responsive design: desktop may use multi-column layouts, while mobile must be single-column without horizontal scrolling.",
    "If real images, videos, maps, pricing, business hours, or facts are missing, use clearly labeled placeholders such as \"To be provided\". Do not invent facts or reference missing local assets.",
  );

  return lines.join("\n");
}

export default function BuilderPage() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectListLoading, setProjectListLoading] = useState(false);
  const [projectActionLoading, setProjectActionLoading] = useState(false);
  const [websiteType, setWebsiteType] = useState("");
  const [customWebsiteType, setCustomWebsiteType] = useState("");
  const [websiteFormat, setWebsiteFormat] = useState("");
  const [mainObjective, setMainObjective] = useState("");
  const [customMainObjective, setCustomMainObjective] = useState("");
  const [brandName, setBrandName] = useState("");
  const [businessDescription, setBusinessDescription] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [toneOfVoice, setToneOfVoice] = useState("");
  const [customToneOfVoice, setCustomToneOfVoice] = useState("");
  const [ctaAction, setCtaAction] = useState("");
  const [customCtaAction, setCustomCtaAction] = useState("");
  const [ctaButtonText, setCtaButtonText] = useState("");
  const [ctaDestination, setCtaDestination] = useState("");
  const [customCtaDestination, setCustomCtaDestination] = useState("");
  const [ctaLink, setCtaLink] = useState("");
  const [designStyle, setDesignStyle] = useState("");
  const [customDesignStyle, setCustomDesignStyle] = useState("");
  const [colorPalette, setColorPalette] = useState("");
  const [customColorPalette, setCustomColorPalette] = useState("");
  const [typographyVibe, setTypographyVibe] = useState("");
  const [layoutDensity, setLayoutDensity] = useState("");
  const [animationLevel, setAnimationLevel] = useState("");
  const [referenceWebsites, setReferenceWebsites] = useState("");
  const [sections, setSections] = useState<string[]>([]);
  const [customSections, setCustomSections] = useState("");
  const [requiredCopy, setRequiredCopy] = useState("");
  const [specialInstructions, setSpecialInstructions] = useState("");
  const [structuredData, setStructuredData] = useState("");
  const [touchedGuidedFields, setTouchedGuidedFields] = useState<Set<GuidedFieldKey>>(() => new Set());
  const [openBuilderSections, setOpenBuilderSections] = useState<string[]>([DEFAULT_GUIDED_SECTION]);
  const [includeGuidedFields, setIncludeGuidedFields] = useState(true);
  const [aiMessage, setAiMessage] = useState("");
  const [promptPreview, setPromptPreview] = useState("");
  const [promptPreviewSource, setPromptPreviewSource] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingHint, setLoadingHint] = useState("Generating...");
  const [bootstrapping, setBootstrapping] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ChatResponse | null>(null);
  const [projectFiles, setProjectFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [fileSearch, setFileSearch] = useState("");
  const [selectedContextFiles, setSelectedContextFiles] = useState<string[]>([]);
  const [includeCurrentFile, setIncludeCurrentFile] = useState(true);
  const [includeSelection, setIncludeSelection] = useState(true);
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [includeChangedFiles, setIncludeChangedFiles] = useState(true);
  const [contextPanelOpen, setContextPanelOpen] = useState(false);
  const [contextSearch, setContextSearch] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [savedFileContent, setSavedFileContent] = useState("");
  const [selectedEditorText, setSelectedEditorText] = useState("");
  const [selectedEditorRange, setSelectedEditorRange] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [fileSaving, setFileSaving] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [webPreviewUrl, setWebPreviewUrl] = useState<string | null>(null);
  const [previewVersion, setPreviewVersion] = useState(0);
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
  const [builtPreviewLoading, setBuiltPreviewLoading] = useState(false);
  const [builtPreviewError, setBuiltPreviewError] = useState<string | null>(null);
  const [deployIntentLoading, setDeployIntentLoading] = useState(false);
  const [lastPromptDeployment, setLastPromptDeployment] = useState<DeploymentRecord | null>(null);
  const [pendingDeployIntent, setPendingDeployIntent] = useState<PendingDeployIntent | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [activeToolTab, setActiveToolTab] = useState<"problems" | "logs" | "terminal" | "jobs">("jobs");
  const [exportDeployOpen, setExportDeployOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameProjectName, setRenameProjectName] = useState("");
  const [renameProjectError, setRenameProjectError] = useState<string | null>(null);
  const saveCurrentFileRef = useRef<() => void>(() => {});
  const monacoEditorRef = useRef<MonacoEditorInstance | null>(null);
  const activeProjectIdRef = useRef<string | null>(null);
  const autoLiveProjectRef = useRef<{ projectId: string; hasDraft: boolean } | null>(null);
  const livePreviewRunRef = useRef(0);
  const lastAiPromptRef = useRef("");
  const activeProject = useMemo(
    () => projects.find((project) => project.project_id === projectId) ?? null,
    [projectId, projects],
  );

  const fileIsDirty = selectedFile !== null && fileContent !== savedFileContent;
  const activePreviewUrl = webPreviewUrl;
  const previewSource = webPreviewUrl ? "live" : "none";
  const verificationStatus = verifyLoading ? "verifying" : diagnostics?.status ?? "idle";
  const changedFiles = useMemo(() => result?.changed_files ?? [], [result?.changed_files]);
  const hasProjectDraft = Boolean(result) || Boolean(activeProject?.has_draft) || ["live_unverified", "verifying", "passed", "failed"].includes(diagnostics?.status ?? "");
  const livePreviewStarting = webBooting && !webPreviewUrl;
  const canOpenBuiltPreview = Boolean(projectId && (hasProjectDraft || projectFiles.length > 0));
  const allGuidedSectionsOpen = GUIDED_SECTION_IDS.every((sectionId) => openBuilderSections.includes(sectionId));
  const filteredProjectFiles = useMemo(() => {
    const query = fileSearch.trim().toLowerCase();
    if (!query) {
      return projectFiles;
    }
    return projectFiles.filter((file) => file.toLowerCase().includes(query));
  }, [fileSearch, projectFiles]);
  const selectedContextSet = useMemo(() => new Set(selectedContextFiles), [selectedContextFiles]);
  const recentChangedFiles = useMemo(
    () => [...new Set(changedFiles.map((file) => file.path).filter((path) => projectFiles.includes(path)))].slice(0, 8),
    [changedFiles, projectFiles],
  );
  const activeContextFiles = useMemo(() => {
    const files = new Set(selectedContextFiles.filter((file) => projectFiles.includes(file)));
    if (includeCurrentFile && selectedFile) {
      files.add(selectedFile);
    }
    if (includeChangedFiles) {
      for (const file of recentChangedFiles) {
        files.add(file);
      }
    }
    return [...files].sort();
  }, [includeChangedFiles, includeCurrentFile, projectFiles, recentChangedFiles, selectedContextFiles, selectedFile]);
  const filteredContextFiles = useMemo(() => {
    const query = contextSearch.trim().toLowerCase();
    if (!query) {
      return projectFiles;
    }
    return projectFiles.filter((file) => file.toLowerCase().includes(query));
  }, [contextSearch, projectFiles]);
  const fileTree = useMemo(() => buildFileTree(filteredProjectFiles), [filteredProjectFiles]);
  const problemCount = (
    (diagnostics?.typescript_errors.length ?? 0)
    + (diagnostics?.runtime_errors.length ?? 0)
    + (diagnostics?.warnings.length ?? result?.warnings.length ?? 0)
    + (diagnosticsError ? 1 : 0)
    + (diagnostics?.status === "failed" && !(diagnostics?.typescript_errors.length || diagnostics?.runtime_errors.length) ? 1 : 0)
  );
  const hasBuildLog = Boolean(diagnostics?.build_log || result?.build_log);
  const buildLogTone = diagnostics?.status === "passed"
    ? "success"
    : diagnostics?.status === "failed"
      ? "error"
      : "neutral";

  const finalPrompt = useMemo(() => {
    return buildStructuredWebsitePrompt({
      websiteType,
      customWebsiteType,
      websiteFormat,
      mainObjective,
      customMainObjective,
      brandName,
      businessDescription,
      targetAudience,
      toneOfVoice,
      customToneOfVoice,
      ctaAction,
      customCtaAction,
      ctaButtonText,
      ctaDestination,
      customCtaDestination,
      ctaLink,
      sections,
      customSections: splitCustomItems(customSections),
      designStyle,
      customDesignStyle,
      colorPalette,
      customColorPalette,
      typographyVibe,
      layoutDensity,
      animationLevel,
      referenceWebsites,
      requiredCopy,
      specialInstructions,
      structuredData,
      touchedFields: touchedGuidedFields,
    });
  }, [
    animationLevel,
    brandName,
    businessDescription,
    colorPalette,
    ctaAction,
    ctaButtonText,
    ctaDestination,
    ctaLink,
    customColorPalette,
    customCtaAction,
    customCtaDestination,
    customDesignStyle,
    customMainObjective,
    customSections,
    customToneOfVoice,
    customWebsiteType,
    designStyle,
    layoutDensity,
    mainObjective,
    referenceWebsites,
    requiredCopy,
    sections,
    specialInstructions,
    structuredData,
    targetAudience,
    toneOfVoice,
    touchedGuidedFields,
    typographyVibe,
    websiteFormat,
    websiteType,
  ]);

  const guidedContextChips = useMemo(() => {
    const chips: string[] = [];
    const websiteLabel = includeGuidedSelectOrCustom(touchedGuidedFields, "websiteType", "customWebsiteType", websiteType, customWebsiteType);
    const goalLabel = includeGuidedSelectOrCustom(touchedGuidedFields, "mainObjective", "customMainObjective", mainObjective, customMainObjective);
    const ctaLabel = includeGuidedField(touchedGuidedFields, "ctaButtonText", ctaButtonText)
      ?? includeGuidedSelectOrCustom(touchedGuidedFields, "ctaAction", "customCtaAction", ctaAction, customCtaAction);
    const designLabel = includeGuidedSelectOrCustom(touchedGuidedFields, "designStyle", "customDesignStyle", designStyle, customDesignStyle);
    const selectedSections = touchedGuidedFields.has("sections") ? sections : [];
    const customSectionCount = touchedGuidedFields.has("customSections") ? splitCustomItems(customSections).length : 0;
    const sectionCount = selectedSections.length + customSectionCount;

    if (websiteLabel) {
      chips.push(`Website: ${websiteLabel}`);
    }
    if (goalLabel) {
      chips.push(`Goal: ${goalLabel}`);
    }
    if (includeGuidedField(touchedGuidedFields, "brandName", brandName)) {
      chips.push(`Brand: ${brandName.trim()}`);
    }
    if (ctaLabel) {
      chips.push(`CTA: ${ctaLabel}`);
    }
    if (designLabel) {
      chips.push(`Design: ${designLabel}`);
    }
    if (sectionCount > 0) {
      chips.push(`Sections: ${sectionCount}`);
    }
    if (
      includeGuidedField(touchedGuidedFields, "requiredCopy", requiredCopy)
      || includeGuidedField(touchedGuidedFields, "specialInstructions", specialInstructions)
      || includeGuidedField(touchedGuidedFields, "structuredData", structuredData)
    ) {
      chips.push("Additional requirements");
    }

    return chips;
  }, [
    brandName,
    ctaAction,
    ctaButtonText,
    customCtaAction,
    customDesignStyle,
    customMainObjective,
    customSections,
    customWebsiteType,
    designStyle,
    mainObjective,
    requiredCopy,
    sections,
    specialInstructions,
    structuredData,
    touchedGuidedFields,
    websiteType,
  ]);
  const currentPromptDraft = buildAiMessageWithGuidedBrief(aiMessage);
  const canGeneratePrompt = Boolean(currentPromptDraft.trim());
  const promptPreviewDirty = Boolean(promptPreviewSource) && promptPreviewSource !== currentPromptDraft;
  const canRunPromptPreview = Boolean(promptPreview.trim()) && !promptPreviewDirty;

  useEffect(() => {
    activeProjectIdRef.current = projectId;
  }, [projectId]);

  const resetProjectSession = useCallback(() => {
    livePreviewRunRef.current += 1;
    setResult(null);
    setProjectFiles([]);
    setSelectedFile(null);
    setOpenFiles([]);
    setFileSearch("");
    setSelectedContextFiles([]);
    setContextPanelOpen(false);
    setContextSearch("");
    setFileContent("");
    setSavedFileContent("");
    setSelectedEditorText("");
    setSelectedEditorRange("");
    setFileError(null);
    setWebPreviewUrl(null);
    setPreviewVersion((current) => current + 1);
    setWebLogs([]);
    setWebError(null);
    setDiagnostics(null);
    setDiagnosticsError(null);
    setEditPreview(null);
    setEditPreviewLoading(false);
    setEditApplyLoading(false);
    setEditPreviewError(null);
    setEditAgentStatus("idle");
    setBuiltPreviewLoading(false);
    setBuiltPreviewError(null);
    setPendingDeployIntent(null);
    setVerifyLoading(false);
    autoLiveProjectRef.current = null;
  }, []);

  const refreshProjectList = useCallback(async () => {
    setProjectListLoading(true);
    try {
      const nextProjects = await listProjects();
      setProjects(nextProjects);
      return nextProjects;
    } finally {
      setProjectListLoading(false);
    }
  }, []);

  const openProject = useCallback((nextProjectId: string) => {
    if (nextProjectId === projectId) {
      return;
    }
    resetProjectSession();
    setProjectId(nextProjectId);
    window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, nextProjectId);
  }, [projectId, resetProjectSession]);

  const createAndOpenProject = useCallback(async () => {
    setProjectActionLoading(true);
    setError(null);
    try {
      const project = await createProject();
      const nextProjects = await refreshProjectList();
      setProjects(nextProjects);
      resetProjectSession();
      setProjectId(project.project_id);
      window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, project.project_id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to create project");
    } finally {
      setProjectActionLoading(false);
    }
  }, [refreshProjectList, resetProjectSession]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrapProjects() {
      setBootstrapping(true);
      setError(null);
      try {
        const nextProjects = await listProjects();
        if (cancelled) {
          return;
        }
        setProjects(nextProjects);

        const storedProjectId = window.localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY);
        const selectedProject = nextProjects.find((project) => project.project_id === storedProjectId) ?? nextProjects[0];
        if (selectedProject) {
          setProjectId(selectedProject.project_id);
          window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, selectedProject.project_id);
          return;
        }

        const project = await createProject();
        if (cancelled) {
          return;
        }
        setProjectId(project.project_id);
        window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, project.project_id);
        const refreshedProjects = await listProjects();
        if (!cancelled) {
          setProjects(refreshedProjects);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to load projects");
        }
      } finally {
        if (!cancelled) {
          setBootstrapping(false);
        }
      }
    }

    void bootstrapProjects();

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

    const filesProjectId = projectId;
    try {
      setFileError(null);
      const files = await listProjectFiles(filesProjectId);
      if (activeProjectIdRef.current !== filesProjectId) {
        return;
      }
      setProjectFiles(files);
      await refreshProjectList();
    } catch (err: unknown) {
      if (activeProjectIdRef.current === filesProjectId) {
        setFileError(err instanceof Error ? err.message : "Unable to load file list");
      }
    }
  }, [projectId, refreshProjectList]);

  const refreshDiagnostics = useCallback(async () => {
    if (!projectId) {
      return;
    }

    const diagnosticsProjectId = projectId;
    try {
      setDiagnosticsError(null);
      const nextDiagnostics = await getProjectDiagnostics(diagnosticsProjectId);
      if (activeProjectIdRef.current !== diagnosticsProjectId) {
        return;
      }
      setDiagnostics(nextDiagnostics);
      if (nextDiagnostics.status === "failed") {
        setActiveToolTab("problems");
      }
    } catch (err: unknown) {
      if (activeProjectIdRef.current === diagnosticsProjectId) {
        setDiagnosticsError(err instanceof Error ? err.message : "Unable to load diagnostics");
        setActiveToolTab("problems");
      }
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
    if (!projectId) {
      return;
    }

    const previewProjectId = projectId;
    const previewHasDraft = hasProjectDraft;
    const runId = livePreviewRunRef.current + 1;
    livePreviewRunRef.current = runId;
    const isCurrentRun = () => activeProjectIdRef.current === previewProjectId && livePreviewRunRef.current === runId;
    const handleServerReady = (url: string) => {
      if (isCurrentRun()) {
        setWebPreviewUrl(url);
      }
    };
    const handleServerRestart = () => {
      if (isCurrentRun()) {
        setWebPreviewUrl(null);
      }
    };
    const appendWebLog = (line: string) => {
      if (isCurrentRun()) {
        setWebLogs((current) => [...current, normalizeTerminalLog(line)]);
      }
    };

    setWebBooting(true);
    setWebError(null);
    setWebLogs([]);

    try {
      const projectFilesToSync = previewHasDraft ? await readProjectFiles(previewProjectId) : [];
      if (!isCurrentRun()) {
        return;
      }

      if (previewHasDraft && projectFilesToSync.length > 0) {
        setProjectFiles(projectFilesToSync.map((file) => file.path).sort());
        await writeFilesToWebContainer(projectFilesToSync, {
          onLog: appendWebLog,
          onServerReady: handleServerReady,
          onServerRestart: handleServerRestart,
          emitCachedServerReady: false,
          restartAfterSync: true,
          resetTemplateStyles: true,
        });
        if (isCurrentRun()) {
          setPreviewVersion((current) => current + 1);
        }
      } else {
        await restoreDefaultWebContainerTemplate({
          onLog: appendWebLog,
          onServerReady: handleServerReady,
          onServerRestart: handleServerRestart,
          emitCachedServerReady: false,
        });
      }
    } catch (err: unknown) {
      if (isCurrentRun()) {
        setWebError(err instanceof Error ? err.message : "Live Preview failed to start");
      }
    } finally {
      if (isCurrentRun()) {
        setWebBooting(false);
      }
    }
  }, [hasProjectDraft, projectId]);

  useEffect(() => {
    if (!projectId) {
      return;
    }

    const currentAutoLive = autoLiveProjectRef.current;
    if (
      currentAutoLive
      && currentAutoLive.projectId === projectId
      && currentAutoLive.hasDraft === hasProjectDraft
    ) {
      return;
    }
    autoLiveProjectRef.current = { projectId, hasDraft: hasProjectDraft };
    const timer = window.setTimeout(() => {
      void startLivePreview();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [hasProjectDraft, projectId, startLivePreview]);

  useEffect(() => {
    if (!historyOpen && !exportDeployOpen && !renameDialogOpen) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [exportDeployOpen, historyOpen, renameDialogOpen]);

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
          onServerRestart: () => setWebPreviewUrl(null),
        },
      );
      setPreviewVersion((current) => current + 1);
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
          preview_url: null,
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
      if (nextDiagnostics.status === "passed") {
        await createSnapshot(projectId, {
          label: "Verified build",
          kind: "verify",
          prompt: lastAiPromptRef.current || finalPrompt,
          notes: nextDiagnostics.notes.join(". "),
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

  async function openBuiltPreviewInNewTab() {
    if (!projectId || builtPreviewLoading) {
      return;
    }

    setBuiltPreviewError(null);
    setBuiltPreviewLoading(true);
    const previewTab = window.open("about:blank", "_blank");
    if (previewTab) {
      previewTab.document.write("<p style=\"font-family: system-ui, sans-serif; padding: 24px;\">Building preview...</p>");
    }

    try {
      const nextDiagnostics = await runProjectBuild(projectId);
      setDiagnostics(nextDiagnostics);

      if (!nextDiagnostics.preview_url) {
        throw new Error(nextDiagnostics.build_log || "Build finished but no preview URL was returned.");
      }

      const nextPreviewUrl = resolvePreviewUrl(nextDiagnostics.preview_url, Date.now());
      if (!nextPreviewUrl) {
        throw new Error("Unable to resolve built preview URL.");
      }

      if (previewTab) {
        previewTab.location.href = nextPreviewUrl;
      } else {
        window.open(nextPreviewUrl, "_blank", "noopener,noreferrer");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unable to build preview";
      setBuiltPreviewError(message);
      setDiagnosticsError(message);
      setActiveToolTab("problems");
      if (previewTab) {
        previewTab.close();
      }
    } finally {
      setBuiltPreviewLoading(false);
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
        onServerRestart: () => setWebPreviewUrl(null),
      });
      setPreviewVersion((current) => current + 1);
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
      setPreviewVersion((current) => current + 1);

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
      setPreviewVersion((current) => current + 1);

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
        onServerRestart: () => setWebPreviewUrl(null),
        resetTemplateStyles: true,
      });

      const selectedUpdate = selectedFile
        ? response.changed_files.find((file) => file.path === selectedFile)
        : undefined;

      if (selectedUpdate) {
        setFileContent(selectedUpdate.content);
        setSavedFileContent(selectedUpdate.content);
      }
      setPreviewVersion((current) => current + 1);
    } catch (err: unknown) {
      setWebError(err instanceof Error ? err.message : "Unable to sync files to WebContainer");
    } finally {
      setWebBooting(false);
    }
  }

  function updateDraft(update: () => void, field?: GuidedFieldKey) {
    update();
    if (!field) {
      return;
    }
    setTouchedGuidedFields((current) => {
      if (current.has(field)) {
        return current;
      }
      const next = new Set(current);
      next.add(field);
      return next;
    });
  }

  function toggleSection(section: string) {
    updateDraft(() => {
      setSections((current) =>
        current.includes(section)
          ? current.filter((item) => item !== section)
          : [...current, section],
      );
    }, "sections");
  }

  function toggleAllBuilderSections() {
    setOpenBuilderSections((current) =>
      GUIDED_SECTION_IDS.every((sectionId) => current.includes(sectionId))
        ? []
        : GUIDED_SECTION_IDS,
    );
  }

  function handleProjectSelect(nextProjectId: string) {
    if (!nextProjectId || nextProjectId === projectId) {
      return;
    }
    if (fileIsDirty && !window.confirm("The current file has unsaved changes. Switch projects anyway?")) {
      return;
    }
    openProject(nextProjectId);
  }

  function openRenameProjectDialog() {
    if (!activeProject) {
      return;
    }
    setRenameProjectName(activeProject.name);
    setRenameProjectError(null);
    setRenameDialogOpen(true);
  }

  async function submitRenameProject() {
    if (!projectId || !activeProject) {
      return;
    }

    const nextName = renameProjectName.trim();
    if (!nextName) {
      setRenameProjectError("Project name is required.");
      return;
    }
    if (nextName === activeProject.name) {
      setRenameDialogOpen(false);
      return;
    }

    setProjectActionLoading(true);
    setRenameProjectError(null);
    setError(null);
    try {
      const updatedProject = await updateProject(projectId, nextName);
      setProjects((current) =>
        current
          .map((project) => project.project_id === updatedProject.project_id ? updatedProject : project)
          .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? "")),
      );
      setRenameDialogOpen(false);
    } catch (err: unknown) {
      setRenameProjectError(err instanceof Error ? err.message : "Unable to rename project");
    } finally {
      setProjectActionLoading(false);
    }
  }

  function buildAiMessageWithGuidedBrief(message: string) {
    const trimmed = message.trim();
    if (!includeGuidedFields) {
      return trimmed;
    }
    return trimmed ? `${trimmed}\n\nGuided brief:\n${finalPrompt}` : finalPrompt;
  }

  function generatePromptPreview() {
    const nextPrompt = buildAiMessageWithGuidedBrief(aiMessage);
    if (!nextPrompt.trim()) {
      return;
    }
    setPromptPreview(nextPrompt);
    setPromptPreviewSource(nextPrompt);
    setEditPreviewError(null);
    setPendingDeployIntent(null);
  }

  async function requestProjectDraft(message: string, mode: ChatMode, snapshotLabel: string) {
    if (!projectId || !message.trim()) {
      return;
    }

    const prompt = message.trim();
    lastAiPromptRef.current = prompt;
    setLoading(true);
    setLoadingHint(mode === "generate" ? "Generating draft..." : "Applying draft...");
    setError(null);
    setEditPreviewError(null);
    setEditPreview(null);
    setEditAgentStatus("editing");

    try {
      const response = await sendChatDraft(projectId, prompt, mode);
      setResult(response);
      setAiMessage("");
      await refreshProjectFiles();
      await syncChatResponseToWebContainer(response);
      await createSnapshot(projectId, {
        label: snapshotLabel,
        kind: mode === "generate" ? "generate" : "edit",
        prompt,
        notes: response.reply,
      }).catch(() => undefined);
      await refreshDiagnostics();
      setEditAgentStatus("verifying");
      const verified = await runBackendVerify();
      setEditAgentStatus(verified?.status === "failed" ? "needs_attention" : "idle");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "AI draft failed";
      setError(message);
      setEditPreviewError(message);
      setEditAgentStatus("needs_attention");
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
      selected_text: includeSelection ? selectedEditorText : "",
      selected_range: includeSelection ? selectedEditorRange : "",
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

  async function requestPromptDeployment(intent: DeployIntent, message: string) {
    if (!projectId) {
      return;
    }

    setDeployIntentLoading(true);
    setEditPreviewError(null);
    setEditPreview(null);
    setPendingDeployIntent(null);
    setEditAgentStatus("applying");
    setActiveToolTab("jobs");

    try {
      const deployment = await deployProject(projectId, {
        provider: intent.provider,
        project_name: intent.projectName,
        site_name: intent.projectName,
      });
      lastAiPromptRef.current = message.trim();
      setLastPromptDeployment(deployment);
      setAiMessage("");
      setExportDeployOpen(true);
      setEditAgentStatus("idle");
    } catch (err: unknown) {
      setEditAgentStatus("needs_attention");
      setEditPreviewError(err instanceof Error ? err.message : "Deployment failed");
    } finally {
      setDeployIntentLoading(false);
    }
  }

  async function runPromptPreview() {
    const prompt = promptPreview.trim();
    if (!prompt || promptPreviewDirty) {
      return;
    }

    const deployIntent = detectDeployIntent(prompt);
    if (deployIntent) {
      if (diagnostics?.status !== "passed") {
        setPendingDeployIntent(null);
        setEditPreviewError("Backend verification must pass before deploying. Run verification first, then ask AI to deploy again.");
        setActiveToolTab("problems");
        return;
      }

      setEditPreviewError(null);
      setEditPreview(null);
      setPendingDeployIntent({ intent: deployIntent, message: prompt });
      setEditAgentStatus("review");
      return;
    }

    if (hasProjectDraft) {
      await requestEditPreview(prompt);
      return;
    }

    await requestProjectDraft(prompt, "generate", "Generated conversational draft");
  }

  async function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    generatePromptPreview();
  }

  async function requestInlineEditPreview() {
    const message = aiMessage.trim()
      || "Make the smallest necessary change to the selected code only, and keep the full file buildable.";
    await requestEditPreview(message);
  }

  async function requestDirectDraftFromComposer() {
    const snapshotLabel = hasProjectDraft ? "AI draft applied" : "Generated conversational draft";
    if (!canRunPromptPreview) {
      return;
    }
    await requestProjectDraft(promptPreview, hasProjectDraft ? "auto" : "generate", snapshotLabel);
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
        preview_url: null,
        build_attempts: result?.build_attempts ?? 0,
        fix_attempts: result?.fix_attempts ?? 0,
        build_log: result?.build_log ?? "",
        warnings: [...(result?.warnings ?? []), ...editPreview.warnings],
        changed_files: response.changed_files,
      };

      setResult(changedResponse);
      lastAiPromptRef.current = aiMessage.trim();
      setAiMessage("");
      setEditPreview(null);
      await refreshProjectFiles();
      await syncChatResponseToWebContainer(changedResponse);
      await createSnapshot(projectId, {
        label: "AI edit applied",
        kind: "edit",
        prompt: aiMessage,
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
          className={`flex items-center rounded-lg pr-2 transition ${
            selectedFile === node.path ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-white"
          }`}
          style={{ paddingLeft: `${8 + depth * 12}px` }}
        >
          <button
            type="button"
            onClick={() => void openProjectFile(node.path)}
            className="min-w-0 flex-1 truncate py-1.5 pl-2 text-left font-mono text-xs"
            disabled={fileLoading || fileSaving}
          >
            {node.name}
          </button>
        </div>
      );
    });
  }

  return (
    <div className="builder-dark min-h-full text-zinc-100">
      <div className="mx-auto flex min-h-full max-w-[1840px] flex-col gap-5 px-4 py-6 lg:flex-row">
        <section className="flex w-full flex-col gap-4 lg:h-[calc(100vh-4rem)] lg:min-h-0 lg:w-[520px] lg:min-w-[360px] lg:max-w-[760px] lg:shrink-0 lg:resize-x lg:overflow-y-auto lg:pr-1">
          <div className="order-0 shrink-0">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold tracking-tight text-white">
                  AI Website Builder
                </h1>
                <p className="mt-2 text-sm leading-6 text-zinc-400">
                  Describe the site. Refine only when needed.
                </p>
              </div>

              <details className="group relative shrink-0">
                <summary
                  className="flex max-w-full list-none items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2 text-xs font-medium text-zinc-200 shadow-sm transition hover:border-cyan-500/60 hover:bg-cyan-500/10 hover:text-cyan-100 sm:w-[220px] [&::-webkit-details-marker]:hidden"
                  title={activeProject?.name ?? "Project"}
                >
                  <span className="min-w-0 flex-1 truncate text-left">
                    {activeProject?.name ?? "Project"}
                  </span>
                  <span className="text-zinc-500 group-open:rotate-180">v</span>
                </summary>

                <div className="absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-zinc-800 bg-zinc-950 p-3 shadow-2xl">
                  <div className="flex items-center justify-between gap-3">
                    <label htmlFor="projectSwitcher" className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Project
                    </label>
                    <span className="text-xs text-zinc-500">
                      {projectListLoading ? "Refreshing..." : `${projects.length} project${projects.length === 1 ? "" : "s"}`}
                    </span>
                  </div>

                  <select
                    id="projectSwitcher"
                    value={projectId ?? ""}
                    onChange={(event) => handleProjectSelect(event.target.value)}
                    disabled={bootstrapping || loading || projectActionLoading || projects.length === 0}
                    className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none ring-cyan-500/40 focus:ring-2 disabled:cursor-not-allowed disabled:text-zinc-500"
                  >
                    {projects.length === 0 ? (
                      <option value="">No projects</option>
                    ) : null}
                    {projects.map((project) => (
                      <option key={project.project_id} value={project.project_id}>
                        {project.name} ({project.file_count})
                      </option>
                    ))}
                  </select>

                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void createAndOpenProject()}
                      disabled={bootstrapping || loading || projectActionLoading}
                      className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:border-cyan-500/60 hover:bg-cyan-500/10 hover:text-cyan-100 disabled:cursor-not-allowed disabled:text-zinc-600"
                    >
                      New
                    </button>
                    <button
                      type="button"
                      onClick={openRenameProjectDialog}
                      disabled={bootstrapping || loading || projectActionLoading || !activeProject}
                      className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:border-cyan-500/60 hover:bg-cyan-500/10 hover:text-cyan-100 disabled:cursor-not-allowed disabled:text-zinc-600"
                    >
                      Rename
                    </button>
                  </div>

                  {activeProject ? (
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-500">
                      <span>{activeProject.has_draft ? "Draft ready" : "Template"}</span>
                      <span>{activeProject.file_count} editable files</span>
                    </div>
                  ) : null}
                </div>
              </details>
            </div>
          </div>

          <div className="order-1 min-h-[220px] flex-1 overflow-auto rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 text-sm shadow-sm backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-zinc-100">Guided fields</p>
                <p className="mt-1 text-xs text-zinc-400">Optional context for AI.</p>
              </div>
              <button
                type="button"
                onClick={toggleAllBuilderSections}
                className="shrink-0 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-cyan-500/60 hover:bg-cyan-500/10 hover:text-cyan-100"
              >
                {allGuidedSectionsOpen ? "Collapse all" : "Expand all"}
              </button>
            </div>

            <Accordion.Root
              type="multiple"
              value={openBuilderSections}
              onValueChange={setOpenBuilderSections}
              className="mt-4 flex flex-col gap-3"
            >
              <Accordion.Item value="websiteGoal" className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
                <Accordion.Header>
                <Accordion.Trigger className="guided-trigger flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition">
                  <span className="block text-sm font-medium text-zinc-800">Website Goal</span>
                  <span className="text-xs font-medium text-zinc-500">{openBuilderSections.includes("websiteGoal") ? "Hide" : "Open"}</span>
                </Accordion.Trigger>
                </Accordion.Header>
                <Accordion.Content>
                  <div className="border-t border-zinc-100 p-4">
                    <div className="grid gap-3">
                      <label className="text-sm font-medium text-zinc-700" htmlFor="websiteType">Website Type</label>
                      <select
                        id="websiteType"
                        value={websiteType}
                        onChange={(event) => updateDraft(() => setWebsiteType(event.target.value), "websiteType")}
                        className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:ring-2"
                        disabled={bootstrapping || loading || !projectId}
                      >
                        <option value="">{GUIDED_SELECT_PLACEHOLDER}</option>
                        {WEBSITE_TYPE_OPTIONS.map((option) => (
                          <option key={option.label} value={option.label}>{option.label}</option>
                        ))}
                      </select>
                      {websiteType ? (
                        <p className="text-xs text-zinc-500">
                          {WEBSITE_TYPE_OPTIONS.find((option) => option.label === websiteType)?.description}
                        </p>
                      ) : null}
                      <input
                        value={customWebsiteType}
                        onChange={(event) => updateDraft(() => setCustomWebsiteType(event.target.value), "customWebsiteType")}
                        className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:ring-2"
                        placeholder="For example: clinic booking website, AI resume builder, real estate landing page"
                        disabled={bootstrapping || loading || !projectId}
                      />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="text-sm font-medium text-zinc-700" htmlFor="websiteFormat">Website Format</label>
                          <select
                            id="websiteFormat"
                            value={websiteFormat}
                            onChange={(event) => updateDraft(() => setWebsiteFormat(event.target.value), "websiteFormat")}
                            className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:ring-2"
                            disabled={bootstrapping || loading || !projectId}
                          >
                            <option value="">{GUIDED_SELECT_PLACEHOLDER}</option>
                            {WEBSITE_FORMAT_OPTIONS.map((option) => (
                              <option key={option} value={option}>{option}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-zinc-700" htmlFor="mainObjective">Main Objective</label>
                          <select
                            id="mainObjective"
                            value={mainObjective}
                            onChange={(event) => updateDraft(() => setMainObjective(event.target.value), "mainObjective")}
                            className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:ring-2"
                            disabled={bootstrapping || loading || !projectId}
                          >
                            <option value="">{GUIDED_SELECT_PLACEHOLDER}</option>
                            {MAIN_OBJECTIVE_OPTIONS.map((option) => (
                              <option key={option} value={option}>{option}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      {mainObjective === "Custom" ? (
                        <input
                          value={customMainObjective}
                          onChange={(event) => updateDraft(() => setCustomMainObjective(event.target.value), "customMainObjective")}
                          className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:ring-2"
                          placeholder="Describe the main goal for this website"
                          disabled={bootstrapping || loading || !projectId}
                        />
                      ) : null}
                    </div>
                  </div>
                </Accordion.Content>
              </Accordion.Item>

              <Accordion.Item value="brandAudience" className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
                <Accordion.Header>
                <Accordion.Trigger className="guided-trigger flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition">
                  <span className="block text-sm font-medium text-zinc-800">Brand & Audience</span>
                  <span className="text-xs font-medium text-zinc-500">{openBuilderSections.includes("brandAudience") ? "Hide" : "Open"}</span>
                </Accordion.Trigger>
                </Accordion.Header>
                <Accordion.Content>
                  <div className="grid gap-3 border-t border-zinc-100 p-4">
                    <input
                      value={brandName}
                      onChange={(event) => updateDraft(() => setBrandName(event.target.value), "brandName")}
                      className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:ring-2"
                      placeholder="Brand / Company Name, for example: Peter AI Studio"
                      disabled={bootstrapping || loading || !projectId}
                    />
                    <textarea
                      value={businessDescription}
                      onChange={(event) => updateDraft(() => setBusinessDescription(event.target.value), "businessDescription")}
                      rows={3}
                      className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm leading-6 outline-none ring-zinc-400 focus:ring-2"
                      placeholder="What do you do? Briefly describe your business, product, service, or personal brand."
                      disabled={bootstrapping || loading || !projectId}
                    />
                    <input
                      value={targetAudience}
                      onChange={(event) => updateDraft(() => setTargetAudience(event.target.value), "targetAudience")}
                      className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:ring-2"
                      placeholder="Target Audience, for example: startup founders, local business owners, patients, students"
                      disabled={bootstrapping || loading || !projectId}
                    />
                    <div>
                      <label className="text-sm font-medium text-zinc-700" htmlFor="toneOfVoice">Tone of Voice</label>
                      <select
                        id="toneOfVoice"
                        value={toneOfVoice}
                        onChange={(event) => updateDraft(() => setToneOfVoice(event.target.value), "toneOfVoice")}
                        className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:ring-2"
                        disabled={bootstrapping || loading || !projectId}
                      >
                        <option value="">{GUIDED_SELECT_PLACEHOLDER}</option>
                        {TONE_OF_VOICE_OPTIONS.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </div>
                    {toneOfVoice === "Custom" ? (
                      <input
                        value={customToneOfVoice}
                        onChange={(event) => updateDraft(() => setCustomToneOfVoice(event.target.value), "customToneOfVoice")}
                        className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:ring-2"
                        placeholder="Describe the tone you want"
                        disabled={bootstrapping || loading || !projectId}
                      />
                    ) : null}
                  </div>
                </Accordion.Content>
              </Accordion.Item>

              <Accordion.Item value="primaryCta" className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
                <Accordion.Header>
                <Accordion.Trigger className="guided-trigger flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition">
                  <span className="block text-sm font-medium text-zinc-800">Primary CTA</span>
                  <span className="text-xs font-medium text-zinc-500">{openBuilderSections.includes("primaryCta") ? "Hide" : "Open"}</span>
                </Accordion.Trigger>
                </Accordion.Header>
                <Accordion.Content>
                  <div className="grid gap-3 border-t border-zinc-100 p-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="text-sm font-medium text-zinc-700" htmlFor="ctaAction">Main Visitor Action</label>
                        <select
                          id="ctaAction"
                          value={ctaAction}
                          onChange={(event) => updateDraft(() => setCtaAction(event.target.value), "ctaAction")}
                          className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:ring-2"
                          disabled={bootstrapping || loading || !projectId}
                        >
                          <option value="">{GUIDED_SELECT_PLACEHOLDER}</option>
                          {CTA_ACTION_OPTIONS.map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-zinc-700" htmlFor="ctaDestination">CTA Destination</label>
                        <select
                          id="ctaDestination"
                          value={ctaDestination}
                          onChange={(event) => updateDraft(() => setCtaDestination(event.target.value), "ctaDestination")}
                          className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:ring-2"
                          disabled={bootstrapping || loading || !projectId}
                        >
                          <option value="">{GUIDED_SELECT_PLACEHOLDER}</option>
                          {CTA_DESTINATION_OPTIONS.map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {ctaAction === "Custom" ? (
                      <input
                        value={customCtaAction}
                        onChange={(event) => updateDraft(() => setCustomCtaAction(event.target.value), "customCtaAction")}
                        className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:ring-2"
                        placeholder="Describe the visitor action you want"
                        disabled={bootstrapping || loading || !projectId}
                      />
                    ) : null}
                    {ctaDestination === "Custom" ? (
                      <input
                        value={customCtaDestination}
                        onChange={(event) => updateDraft(() => setCustomCtaDestination(event.target.value), "customCtaDestination")}
                        className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:ring-2"
                        placeholder="Describe where the CTA should go"
                        disabled={bootstrapping || loading || !projectId}
                      />
                    ) : null}
                    <input
                      value={ctaButtonText}
                      onChange={(event) => updateDraft(() => setCtaButtonText(event.target.value), "ctaButtonText")}
                      className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:ring-2"
                      placeholder="CTA Button Text, for example: Contact Us, Get Started, Book a Demo"
                      disabled={bootstrapping || loading || !projectId}
                    />
                    <input
                      value={ctaLink}
                      onChange={(event) => updateDraft(() => setCtaLink(event.target.value), "ctaLink")}
                      className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:ring-2"
                      placeholder="Optional: paste URL, email, phone number, or anchor link"
                      disabled={bootstrapping || loading || !projectId}
                    />
                  </div>
                </Accordion.Content>
              </Accordion.Item>

              <Accordion.Item value="designPreferences" className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
                <Accordion.Header>
                <Accordion.Trigger className="guided-trigger flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition">
                  <span className="block text-sm font-medium text-zinc-800">Design Preferences</span>
                  <span className="text-xs font-medium text-zinc-500">{openBuilderSections.includes("designPreferences") ? "Hide" : "Open"}</span>
                </Accordion.Trigger>
                </Accordion.Header>
                <Accordion.Content>
                  <div className="grid gap-3 border-t border-zinc-100 p-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="text-sm font-medium text-zinc-700" htmlFor="designStyle">Design Style</label>
                        <select
                          id="designStyle"
                          value={designStyle}
                          onChange={(event) => updateDraft(() => setDesignStyle(event.target.value), "designStyle")}
                          className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:ring-2"
                          disabled={bootstrapping || loading || !projectId}
                        >
                          <option value="">{GUIDED_SELECT_PLACEHOLDER}</option>
                          {DESIGN_STYLE_OPTIONS.map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-zinc-700" htmlFor="colorPalette">Color Palette</label>
                        <select
                          id="colorPalette"
                          value={colorPalette}
                          onChange={(event) => updateDraft(() => setColorPalette(event.target.value), "colorPalette")}
                          className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:ring-2"
                          disabled={bootstrapping || loading || !projectId}
                        >
                          <option value="">{GUIDED_SELECT_PLACEHOLDER}</option>
                          {COLOR_PALETTE_OPTIONS.map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {designStyle === "Custom" ? (
                      <input
                        value={customDesignStyle}
                        onChange={(event) => updateDraft(() => setCustomDesignStyle(event.target.value), "customDesignStyle")}
                        className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:ring-2"
                        placeholder="Describe a custom visual style"
                        disabled={bootstrapping || loading || !projectId}
                      />
                    ) : null}
                    <input
                      value={customColorPalette}
                      onChange={(event) => updateDraft(() => setCustomColorPalette(event.target.value), "customColorPalette")}
                      className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:ring-2"
                      placeholder="Custom Color Palette, for example: navy blue, white, and gold"
                      disabled={bootstrapping || loading || !projectId}
                    />
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <label className="text-sm font-medium text-zinc-700" htmlFor="typographyVibe">Typography Vibe</label>
                        <select
                          id="typographyVibe"
                          value={typographyVibe}
                          onChange={(event) => updateDraft(() => setTypographyVibe(event.target.value), "typographyVibe")}
                          className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:ring-2"
                          disabled={bootstrapping || loading || !projectId}
                        >
                          <option value="">{GUIDED_SELECT_PLACEHOLDER}</option>
                          {TYPOGRAPHY_VIBE_OPTIONS.map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-zinc-700" htmlFor="layoutDensity">Layout Density</label>
                        <select
                          id="layoutDensity"
                          value={layoutDensity}
                          onChange={(event) => updateDraft(() => setLayoutDensity(event.target.value), "layoutDensity")}
                          className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:ring-2"
                          disabled={bootstrapping || loading || !projectId}
                        >
                          <option value="">{GUIDED_SELECT_PLACEHOLDER}</option>
                          {LAYOUT_DENSITY_OPTIONS.map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-zinc-700" htmlFor="animationLevel">Animation Level</label>
                        <select
                          id="animationLevel"
                          value={animationLevel}
                          onChange={(event) => updateDraft(() => setAnimationLevel(event.target.value), "animationLevel")}
                          className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:ring-2"
                          disabled={bootstrapping || loading || !projectId}
                        >
                          <option value="">{GUIDED_SELECT_PLACEHOLDER}</option>
                          {ANIMATION_LEVEL_OPTIONS.map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <textarea
                      value={referenceWebsites}
                      onChange={(event) => updateDraft(() => setReferenceWebsites(event.target.value), "referenceWebsites")}
                      rows={3}
                      className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm leading-6 outline-none ring-zinc-400 focus:ring-2"
                      placeholder="Reference Websites: Optional, paste websites you like"
                      disabled={bootstrapping || loading || !projectId}
                    />
                  </div>
                </Accordion.Content>
              </Accordion.Item>

              <Accordion.Item value="pagesSections" className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
                <Accordion.Header>
                <Accordion.Trigger className="guided-trigger flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition">
                  <span className="block text-sm font-medium text-zinc-800">Pages & Sections</span>
                  <span className="text-xs font-medium text-zinc-500">{openBuilderSections.includes("pagesSections") ? "Hide" : "Open"}</span>
                </Accordion.Trigger>
                </Accordion.Header>
                <Accordion.Content>
                  <div className="grid gap-4 border-t border-zinc-100 p-4">
                    {SECTION_GROUPS.map((group) => (
                      <div key={group.title}>
                        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{group.title}</p>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          {group.items.map((section) => (
                            <label key={section} className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-700">
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
                      </div>
                    ))}
                    <input
                      value={customSections}
                      onChange={(event) => updateDraft(() => setCustomSections(event.target.value), "customSections")}
                      className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:ring-2"
                      placeholder="For example: timeline, team, comparison table, gallery"
                      disabled={bootstrapping || loading || !projectId}
                    />
                  </div>
                </Accordion.Content>
              </Accordion.Item>

              <Accordion.Item value="additionalRequirements" className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
                <Accordion.Header>
                <Accordion.Trigger className="guided-trigger flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition">
                  <span className="block text-sm font-medium text-zinc-800">Additional Requirements</span>
                  <span className="text-xs font-medium text-zinc-500">{openBuilderSections.includes("additionalRequirements") ? "Hide" : "Open"}</span>
                </Accordion.Trigger>
                </Accordion.Header>
                <Accordion.Content>
                  <div className="grid gap-3 border-t border-zinc-100 p-4">
                    <textarea
                      value={requiredCopy}
                      onChange={(event) => updateDraft(() => setRequiredCopy(event.target.value), "requiredCopy")}
                      rows={4}
                      className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm leading-6 outline-none ring-zinc-400 focus:ring-2"
                      placeholder="Required Copy / Content: Paste exact text, product descriptions, pricing plans, FAQ, testimonials, or business details."
                      disabled={bootstrapping || loading || !projectId}
                    />
                    <textarea
                      value={specialInstructions}
                      onChange={(event) => updateDraft(() => setSpecialInstructions(event.target.value), "specialInstructions")}
                      rows={3}
                      className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm leading-6 outline-none ring-zinc-400 focus:ring-2"
                      placeholder="Special Instructions, for example: make the website sound premium but not too corporate."
                      disabled={bootstrapping || loading || !projectId}
                    />
                    <textarea
                      value={structuredData}
                      onChange={(event) => updateDraft(() => setStructuredData(event.target.value), "structuredData")}
                      rows={4}
                      className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm leading-6 outline-none ring-zinc-400 focus:ring-2"
                      placeholder="Data / Structured Information, for example: pricing plans, service list, team members, locations, opening hours."
                      disabled={bootstrapping || loading || !projectId}
                    />
                  </div>
                </Accordion.Content>
              </Accordion.Item>
            </Accordion.Root>
          </div>

          {projectId ? (
            <form onSubmit={handleEditSubmit} className="order-2 flex shrink-0 flex-col gap-3 rounded-2xl border border-cyan-500/25 bg-slate-950/90 p-4 shadow-sm backdrop-blur lg:max-h-[72vh] lg:min-h-[320px] lg:overflow-y-auto">
              <div className="flex items-start justify-between gap-3">
                <label htmlFor="aiPrompt" className="text-sm font-medium text-cyan-100">
                  Ask AI
                </label>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${editAgentStatusClass(editAgentStatus)}`}>
                    {editAgentStatusLabel(editAgentStatus)}
                  </span>
                  <label className="flex items-center gap-2 text-xs font-medium text-zinc-300">
                    <input
                      type="checkbox"
                      checked={includeGuidedFields}
                      onChange={(event) => setIncludeGuidedFields(event.target.checked)}
                      disabled={bootstrapping || loading || deployIntentLoading || !projectId}
                    />
                    Include guided fields
                  </label>
                </div>
              </div>

              <div className={`rounded-xl border px-3 py-2 text-xs leading-5 ${
                includeGuidedFields
                  ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-100"
                  : "border-zinc-200 bg-zinc-50 text-zinc-500"
              }`}>
                <p className="font-medium">
                  {includeGuidedFields ? "Included context" : "Guided fields excluded"}
                </p>
                {includeGuidedFields ? (
                  guidedContextChips.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {guidedContextChips.map((chip) => (
                        <span key={chip} className="rounded-full border border-cyan-500/30 bg-slate-900 px-2 py-0.5 text-[11px] text-cyan-100">
                          {chip}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-1">No guided fields added yet. Open Guided fields above to add context.</p>
                  )
                ) : (
                  <p className="mt-1">Only the text you type below will be sent.</p>
                )}
              </div>

              <textarea
                id="aiPrompt"
                rows={5}
                value={aiMessage}
                onChange={(event) => {
                  setAiMessage(event.target.value);
                  setPendingDeployIntent(null);
                }}
                className="max-h-56 min-h-32 w-full resize-y rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm leading-6 text-zinc-100 outline-none ring-cyan-400 focus:ring-2"
                placeholder={
                  hasProjectDraft
                    ? "For example: research stronger CTA copy, update the Hero, then prepare a Diff Review"
                    : "For example: research modern bilingual joke sites, then build a searchable archive with categories"
                }
                disabled={bootstrapping || loading || deployIntentLoading || !projectId}
              />

              {promptPreview ? (
                <div className={`rounded-xl border p-3 text-xs ${
                  promptPreviewDirty
                    ? "border-amber-200 bg-amber-50 text-amber-900"
                    : "border-emerald-200 bg-emerald-50 text-emerald-900"
                }`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">Final Prompt Preview</p>
                      <p className="mt-1 leading-5">
                        {promptPreviewDirty
                          ? "Guided fields or Ask AI changed. Regenerate the prompt before generating."
                          : "This is the exact prompt that will be sent."}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setPromptPreview("");
                        setPromptPreviewSource("");
                      }}
                      className="shrink-0 rounded-lg border border-current px-2 py-1 text-[11px] font-medium"
                      disabled={loading || editPreviewLoading || deployIntentLoading}
                    >
                      Back
                    </button>
                  </div>
                  <textarea
                    value={promptPreview}
                    onChange={(event) => setPromptPreview(event.target.value)}
                    rows={7}
                    className="mt-3 max-h-56 w-full resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-[11px] leading-5 text-zinc-800 outline-none ring-cyan-400 focus:ring-2"
                    disabled={loading || editPreviewLoading || editApplyLoading || deployIntentLoading}
                  />
                </div>
              ) : null}

              {lastPromptDeployment ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-800">
                  <p className="font-medium">Deployment ready via {lastPromptDeployment.provider}.</p>
                  {lastPromptDeployment.url ? (
                    <a href={lastPromptDeployment.url} target="_blank" rel="noreferrer" className="mt-1 block underline underline-offset-4">
                      {lastPromptDeployment.url}
                    </a>
                  ) : (
                    <p className="mt-1">{lastPromptDeployment.message}</p>
                  )}
                </div>
              ) : null}

              {pendingDeployIntent ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                  <p className="font-medium">
                    Confirm deployment to {pendingDeployIntent.intent.provider}
                    {pendingDeployIntent.intent.projectName ? ` as ${pendingDeployIntent.intent.projectName}` : ""}
                  </p>
                  <p className="mt-1">
                    This will publish the current verified build and create a deployment job.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void requestPromptDeployment(pendingDeployIntent.intent, pendingDeployIntent.message)}
                      disabled={deployIntentLoading}
                      className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-amber-800 disabled:bg-amber-300"
                    >
                      Confirm Deployment
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPendingDeployIntent(null);
                        setEditAgentStatus("idle");
                      }}
                      disabled={deployIntentLoading}
                      className="rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 transition hover:bg-amber-100"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}

              {hasProjectDraft ? (
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-zinc-700">Context</p>
                    <p className="mt-1 leading-5 text-zinc-500">
                      Context is selected automatically. Remove chips or add files only when needed.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setContextPanelOpen((current) => !current)}
                    className="shrink-0 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50"
                  >
                    {contextPanelOpen ? "Hide context" : "Add context"}
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {includeCurrentFile && selectedFile ? (
                    <button
                      type="button"
                      onClick={() => setIncludeCurrentFile(false)}
                      className="rounded-full border border-zinc-200 bg-white px-2 py-1 font-mono text-[11px] text-zinc-700 hover:bg-zinc-100"
                      title="Remove current file context"
                    >
                      Current file: {selectedFile} x
                    </button>
                  ) : null}
                  {includeSelection && selectedEditorText ? (
                    <button
                      type="button"
                      onClick={() => setIncludeSelection(false)}
                      className="rounded-full border border-cyan-500/30 bg-white px-2 py-1 font-mono text-[11px] text-cyan-700 hover:bg-cyan-50"
                      title="Remove selected text context"
                    >
                      Selection: {selectedEditorText.split(/\r?\n/).length} lines x
                    </button>
                  ) : null}
                  {includeDiagnostics && diagnostics ? (
                    <button
                      type="button"
                      onClick={() => setIncludeDiagnostics(false)}
                      className="rounded-full border border-amber-200 bg-white px-2 py-1 text-[11px] text-amber-800 hover:bg-amber-50"
                      title="Remove diagnostics context"
                    >
                      Diagnostics x
                    </button>
                  ) : null}
                  {includeChangedFiles && recentChangedFiles.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setIncludeChangedFiles(false)}
                      className="rounded-full border border-emerald-200 bg-white px-2 py-1 text-[11px] text-emerald-800 hover:bg-emerald-50"
                      title="Remove recently changed files context"
                    >
                      Recently changed: {recentChangedFiles.length} files x
                    </button>
                  ) : null}
                  {selectedContextFiles.filter((file) => projectFiles.includes(file)).map((file) => (
                    <button
                      key={file}
                      type="button"
                      onClick={() => toggleContextFile(file)}
                      className="rounded-full border border-zinc-200 bg-white px-2 py-1 font-mono text-[11px] text-zinc-700 hover:bg-zinc-100"
                      title="Remove file context"
                    >
                      File: {file} x
                    </button>
                  ))}
                  {activeContextFiles.length === 0 && !(includeSelection && selectedEditorText) && !(includeDiagnostics && diagnostics) ? (
                    <span className="rounded-full bg-white px-2 py-1 text-[11px] text-zinc-500">
                      Automatic project context
                    </span>
                  ) : null}
                </div>

                {contextPanelOpen ? (
                  <div className="mt-3 rounded-lg border border-zinc-200 bg-white p-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={includeCurrentFile}
                          onChange={(event) => setIncludeCurrentFile(event.target.checked)}
                        />
                        Current file
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={includeSelection}
                          onChange={(event) => setIncludeSelection(event.target.checked)}
                          disabled={!selectedEditorText}
                        />
                        Selected text
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={includeDiagnostics}
                          onChange={(event) => setIncludeDiagnostics(event.target.checked)}
                        />
                        Diagnostics
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={includeChangedFiles}
                          onChange={(event) => setIncludeChangedFiles(event.target.checked)}
                          disabled={recentChangedFiles.length === 0}
                        />
                        Recently changed files
                      </label>
                    </div>

                    <div className="mt-3">
                      <input
                        value={contextSearch}
                        onChange={(event) => setContextSearch(event.target.value)}
                        className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs outline-none ring-cyan-400 focus:ring-2"
                        placeholder="Search files to add context..."
                      />
                      <div className="mt-2 max-h-40 overflow-auto rounded-lg border border-zinc-200">
                        {filteredContextFiles.slice(0, 80).map((file) => (
                          <label key={file} className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2 font-mono text-[11px] last:border-b-0">
                            <input
                              type="checkbox"
                              checked={selectedContextSet.has(file)}
                              onChange={() => toggleContextFile(file)}
                            />
                            {file}
                          </label>
                        ))}
                        {filteredContextFiles.length === 0 ? (
                          <p className="px-3 py-2 text-[11px] text-zinc-500">No files found.</p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
              ) : (
                <p className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs leading-5 text-zinc-500">
                  No project files yet. Describe the site or app you want, and AI will create the first draft directly from this conversation.
                </p>
              )}

              <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-col gap-2 border-t border-cyan-500/20 bg-slate-950/95 px-4 py-3 backdrop-blur sm:flex-row">
                {hasProjectDraft ? (
                  <button
                  type="button"
                  onClick={() => void requestInlineEditPreview()}
                  disabled={
                    bootstrapping
                    || loading
                    || editPreviewLoading
                    || editApplyLoading
                    || deployIntentLoading
                    || !projectId
                    || !selectedEditorText
                  }
                  className="rounded-xl border border-cyan-500/35 px-4 py-2.5 text-sm font-medium text-cyan-100 transition hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:text-zinc-500"
                >
                  Edit Selection with AI
                </button>
                ) : null}
                {hasProjectDraft ? (
                  <button
                    type="button"
                    onClick={() => void requestDirectDraftFromComposer()}
                    disabled={bootstrapping || loading || editPreviewLoading || editApplyLoading || deployIntentLoading || !projectId || !canRunPromptPreview}
                    className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-300"
                  >
                    {loading ? loadingHint : "Apply as Draft"}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={promptPreview && !promptPreviewDirty ? () => void runPromptPreview() : generatePromptPreview}
                  disabled={
                    bootstrapping
                    || loading
                    || editPreviewLoading
                    || editApplyLoading
                    || deployIntentLoading
                    || !projectId
                    || (promptPreview && !promptPreviewDirty ? !canRunPromptPreview : !canGeneratePrompt)
                  }
                  className="rounded-xl bg-cyan-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:bg-zinc-500 sm:flex-1"
                >
                  {deployIntentLoading
                    ? "Deploying..."
                    : loading
                      ? loadingHint
                      : editPreviewLoading
                        ? "Generating diff..."
                        : promptPreview && !promptPreviewDirty
                          ? hasProjectDraft
                            ? "Generate Diff Review"
                            : "Generate Website"
                          : promptPreviewDirty
                            ? "Regenerate Prompt"
                            : "Generate Prompt"}
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
            <div className="rounded-xl border border-cyan-500/30 bg-white p-4 text-sm shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-cyan-100">Diff Review</p>
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
                    className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:bg-zinc-500"
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

          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
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

          <div className="order-3 rounded-xl border border-zinc-200 bg-white shadow-sm">
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

          <div className="order-2 rounded-xl border border-zinc-200 bg-white shadow-sm">
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

            <Tabs.Root
              value={activeToolTab}
              onValueChange={(value) => setActiveToolTab(value as "problems" | "logs" | "terminal" | "jobs")}
            >
            <div className="border-b border-zinc-200 px-3 pt-3">
              <Tabs.List className="flex flex-wrap gap-2" aria-label="Workspace tools">
                {[
                  { id: "jobs", label: "Jobs", badge: 0 },
                  { id: "problems", label: "Problems", badge: problemCount },
                  { id: "logs", label: "Build Logs", badge: hasBuildLog ? 1 : 0 },
                  { id: "terminal", label: "Terminal", badge: 0 },
                ].map((tab) => (
                  <Tabs.Trigger
                    key={tab.id}
                    value={tab.id}
                    className={`rounded-t-lg px-3 py-2 text-xs font-medium ${
                      activeToolTab === tab.id
                        ? "border border-b-white border-zinc-200 bg-white text-zinc-900"
                        : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900"
                    }`}
                  >
                    {tab.label}
                    {tab.badge > 0 ? (
                      <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] ${
                        tab.id === "problems"
                          ? "bg-red-100 text-red-700"
                          : "bg-zinc-100 text-zinc-600"
                      }`}>
                        {tab.badge}
                      </span>
                    ) : null}
                  </Tabs.Trigger>
                ))}
              </Tabs.List>
            </div>

            <div className="min-h-52 p-4 text-sm">
              <Tabs.Content value="problems">
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
              </Tabs.Content>

              <Tabs.Content value="logs">
                {hasBuildLog ? (
                  <div className={`rounded-lg border ${
                    buildLogTone === "success"
                      ? "border-emerald-200 bg-emerald-50"
                      : buildLogTone === "error"
                        ? "border-red-200 bg-red-50"
                        : "border-zinc-200 bg-zinc-50"
                  }`}>
                    <div className="border-b border-current/10 px-3 py-2">
                      <p className={`text-xs font-medium ${
                        buildLogTone === "success"
                          ? "text-emerald-800"
                          : buildLogTone === "error"
                            ? "text-red-800"
                            : "text-zinc-700"
                      }`}>
                        {buildLogTone === "success" ? "Build succeeded" : buildLogTone === "error" ? "Build failed" : "Build log"}
                      </p>
                    </div>
                    <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all p-3 text-xs leading-5 text-zinc-800">
                      {diagnostics?.build_log || result?.build_log}
                    </pre>
                  </div>
                ) : (
                  <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
                    No build log yet.
                  </p>
                )}
              </Tabs.Content>

              <Tabs.Content value="terminal">
                <TerminalPanel
                  projectId={projectId}
                  compact
                  onServerReady={(url) => setWebPreviewUrl(url)}
                />
              </Tabs.Content>

              <Tabs.Content value="jobs">
                <JobPanel projectId={projectId} compact />
              </Tabs.Content>
            </div>
            </Tabs.Root>
          </div>

          <div className="order-1 flex flex-1 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-medium text-zinc-700">Preview</h2>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      activePreviewUrl && hasProjectDraft ? verificationStatusClass(verificationStatus) : "bg-zinc-100 text-zinc-500"
                    }`}
                  >
                    {webPreviewUrl ? (hasProjectDraft ? "Live" : "Website not generated yet") : livePreviewStarting ? "Starting Live" : "No preview"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  Live Preview runs in WebContainer. Open in New Tab builds a full-page preview from the current project files.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {canOpenBuiltPreview ? (
                  <button
                    type="button"
                    onClick={() => void openBuiltPreviewInNewTab()}
                    disabled={builtPreviewLoading || loading || !projectId}
                    className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-300"
                  >
                    {builtPreviewLoading ? "Building Preview..." : "Open in New Tab"}
                  </button>
                ) : null}
              </div>
            </div>

            {builtPreviewError ? (
              <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                Built preview failed: {builtPreviewError}
              </div>
            ) : null}

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
              <div className="min-h-0 flex-1 overflow-auto bg-zinc-100">
                {!hasProjectDraft ? (
                  <div className="border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-xs text-zinc-600">
                    Website not generated yet. The preview environment is ready and will update after you generate a website.
                  </div>
                ) : null}
                <iframe
                  key={`${previewSource}-${activePreviewUrl}-${previewVersion}`}
                  title="Website preview"
                  src={activePreviewUrl}
                  scrolling="yes"
                  className="block h-[calc(100vh-12rem)] min-h-[70vh] w-full min-w-[1200px] border-0 bg-white"
                />
              </div>
            ) : (
              <div className="flex h-full min-h-[70vh] w-full items-center justify-center px-6 text-center text-sm text-zinc-500">
                {livePreviewStarting ? "Starting Live Preview..." : "Website not generated yet. Start with Ask AI to create a website preview."}
              </div>
            )}
          </div>
        </section>
      </div>

      {historyOpen ? (
        <div
          className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-zinc-950/90 px-4 py-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Version history"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setHistoryOpen(false);
            }
          }}
        >
          <div className="builder-modal-panel flex h-[68vh] max-h-[82vh] w-full max-w-4xl cursor-default flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950 shadow-2xl">
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
                    preview_url: null,
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

      {renameDialogOpen ? (
        <div
          className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-zinc-950/90 px-4 py-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Rename project"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !projectActionLoading) {
              setRenameDialogOpen(false);
            }
          }}
        >
          <form
            className="builder-modal-panel w-full max-w-md cursor-default rounded-2xl border border-zinc-700 bg-zinc-950 shadow-2xl"
            onSubmit={(event) => {
              event.preventDefault();
              void submitRenameProject();
            }}
          >
            <div className="border-b border-zinc-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-zinc-900">Rename Project</h2>
              <p className="mt-1 text-xs text-zinc-500">
                Choose a short name for the project switcher.
              </p>
            </div>

            <div className="space-y-3 p-4">
              <label className="block text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="renameProjectName">
                Project name
              </label>
              <input
                id="renameProjectName"
                value={renameProjectName}
                onChange={(event) => {
                  setRenameProjectName(event.target.value);
                  setRenameProjectError(null);
                }}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none ring-cyan-500/40 focus:ring-2 disabled:cursor-not-allowed disabled:text-zinc-500"
                disabled={projectActionLoading}
                autoFocus
              />
              {renameProjectError ? (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {renameProjectError}
                </p>
              ) : null}
            </div>

            <div className="flex justify-end gap-2 border-t border-zinc-200 px-4 py-3">
              <button
                type="button"
                onClick={() => setRenameDialogOpen(false)}
                disabled={projectActionLoading}
                className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={projectActionLoading || !renameProjectName.trim()}
                className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:bg-zinc-500"
              >
                {projectActionLoading ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {exportDeployOpen ? (
        <div
          className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-zinc-950/90 px-4 py-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Export and deploy"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setExportDeployOpen(false);
            }
          }}
        >
          <div className="builder-modal-panel max-h-[90vh] w-full max-w-3xl cursor-default overflow-auto rounded-2xl border border-zinc-700 bg-zinc-950 shadow-2xl">
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

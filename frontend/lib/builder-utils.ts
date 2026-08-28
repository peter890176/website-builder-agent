import type { ProjectDiagnosticsResponse } from "@/lib/api";

export type FileTreeNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  children: FileTreeNode[];
};

export function normalizeTerminalLog(line: string): string {
  return line
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\[(?:\d+[A-Z]|\d+G|\d+K|K)/g, "")
    .replace(/[^\S\r\n]{80,}/g, " ");
}

export function buildFileTree(files: string[]): FileTreeNode[] {
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
        node = { name: part, path: currentPath, type: isFile ? "file" : "folder", children: [] };
        currentLevel.push(node);
        currentLevel.sort((a, b) => {
          if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      }
      currentLevel = node.children;
    });
  }
  return root;
}

export function defaultFileContent(path: string): string {
  if (path.endsWith(".tsx") || path.endsWith(".jsx")) {
    const componentName = path.split("/").pop()?.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9]/g, "") || "Component";
    return ['import React from "react";', "", `export function ${componentName}() {`, "  return <div>New component</div>;", "}", ""].join("\n");
  }
  if (path.endsWith(".ts") || path.endsWith(".js")) return "export {};\n";
  if (path.endsWith(".json")) return "{}\n";
  return "";
}

export function languageForFile(path: string | null): string {
  if (!path) return "plaintext";
  if (path.endsWith(".tsx") || path.endsWith(".jsx") || path.endsWith(".ts")) return "typescript";
  if (path.endsWith(".js")) return "javascript";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".json") || path.endsWith(".geojson")) return "json";
  if (path.endsWith(".html")) return "html";
  if (path.endsWith(".svg")) return "xml";
  return "plaintext";
}

export function buildDiagnosticsSummary(diagnostics: ProjectDiagnosticsResponse | null): string {
  if (!diagnostics) return "";
  const lines = [
    `status: ${diagnostics.status}`,
    ...diagnostics.typescript_errors.slice(0, 8).map((item) => `${item.file}:${item.line}:${item.col} TS${item.code} ${item.message}`),
    ...diagnostics.runtime_errors.slice(0, 5).map((item) => `runtime: ${item}`),
    ...diagnostics.notes.slice(0, 5).map((item) => `note: ${item}`),
  ];
  if (diagnostics.build_log && diagnostics.status === "failed") lines.push(`build_log: ${diagnostics.build_log.slice(0, 1200)}`);
  return lines.join("\n");
}

export function verificationStatusLabel(status: ProjectDiagnosticsResponse["status"]): string {
  if (status === "live_unverified" || status === "verifying") return "Finishing Website";
  if (status === "passed") return "Ready";
  if (status === "failed") return "Needs Attention";
  if (status === "drafting") return "Creating Website";
  return "Not Started";
}

export function verificationStatusClass(status: ProjectDiagnosticsResponse["status"]): string {
  if (status === "passed") return "bg-emerald-100 text-emerald-800";
  if (status === "failed") return "bg-red-100 text-red-700";
  if (status === "live_unverified") return "bg-sky-100 text-sky-800";
  if (status === "verifying" || status === "drafting") return "bg-amber-100 text-amber-800";
  return "bg-zinc-100 text-zinc-500";
}

export type EditAgentStatus = "idle" | "editing" | "review" | "applying" | "verifying" | "needs_attention";

export function editAgentStatusLabel(status: EditAgentStatus): string {
  if (status === "editing") return "Editing";
  if (status === "review") return "Review Changes";
  if (status === "applying") return "Applying";
  if (status === "verifying") return "Finishing Website";
  if (status === "needs_attention") return "Needs Attention";
  return "Ready";
}

export function editAgentStatusClass(status: EditAgentStatus): string {
  if (status === "needs_attention") return "bg-red-100 text-red-700";
  if (status === "idle") return "bg-zinc-100 text-zinc-500";
  if (status === "review") return "bg-cyan-100 text-cyan-800";
  return "bg-amber-100 text-amber-800";
}

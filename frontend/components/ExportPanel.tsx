"use client";

import { exportZipUrl, type ProjectDiagnosticsResponse } from "@/lib/api";

type ExportPanelProps = {
  projectId: string | null;
  diagnostics: ProjectDiagnosticsResponse | null;
  chrome?: boolean;
};

const enabledLinkClass = "rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50";
const disabledLinkClass = "cursor-not-allowed rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-400";

export function ExportPanel({ projectId, diagnostics, chrome = true }: ExportPanelProps) {
  const canDownloadBuild = Boolean(projectId && diagnostics?.status === "passed");

  const content = (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-2">
        {projectId ? (
          <a href={exportZipUrl(projectId, false)} className={enabledLinkClass}>
            Download workspace ZIP
          </a>
        ) : (
          <span aria-disabled="true" className={disabledLinkClass}>
            Download workspace ZIP
          </span>
        )}
        {canDownloadBuild && projectId ? (
          <a href={exportZipUrl(projectId, true)} className={enabledLinkClass}>
            Download production ZIP
          </a>
        ) : (
          <span aria-disabled="true" className={disabledLinkClass}>
            Download production ZIP
          </span>
        )}
      </div>
      {!canDownloadBuild ? (
        <p className="text-xs text-amber-700">Run verification successfully to download the production build.</p>
      ) : null}
    </div>
  );

  if (!chrome) {
    return content;
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-4 py-3">
        <h2 className="text-sm font-medium text-zinc-800">Export</h2>
        <p className="mt-1 text-xs text-zinc-500">Download the editable workspace or verified production build as a ZIP archive.</p>
      </div>
      <div className="p-4">{content}</div>
    </div>
  );
}

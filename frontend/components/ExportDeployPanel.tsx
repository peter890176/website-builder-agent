"use client";

import { useCallback, useEffect, useState } from "react";

import {
  deployProject,
  exportToGitHub,
  exportZipUrl,
  listDeployments,
  type DeploymentRecord,
  type ProjectDiagnosticsResponse,
} from "@/lib/api";

type ExportDeployPanelProps = {
  projectId: string | null;
  diagnostics: ProjectDiagnosticsResponse | null;
  chrome?: boolean;
};

export function ExportDeployPanel({ projectId, diagnostics, chrome = true }: ExportDeployPanelProps) {
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [provider, setProvider] = useState<"vercel" | "netlify" | "cloudflare">("vercel");
  const [projectName, setProjectName] = useState("");
  const [deployments, setDeployments] = useState<DeploymentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canDeploy = diagnostics?.status === "passed";

  const refreshDeployments = useCallback(async () => {
    if (!projectId) {
      return;
    }
    setDeployments(await listDeployments(projectId));
  }, [projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshDeployments().catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshDeployments]);

  async function exportGitHub() {
    if (!projectId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await exportToGitHub(projectId, {
        owner,
        repo,
        create_repo: true,
        commit_message: "Export website-builder-agent project",
      });
      await refreshDeployments();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "GitHub export failed");
    } finally {
      setLoading(false);
    }
  }

  async function deploy() {
    if (!projectId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await deployProject(projectId, {
        provider,
        project_name: projectName,
        site_name: projectName,
      });
      await refreshDeployments();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Deployment failed");
    } finally {
      setLoading(false);
    }
  }

  const content = (
    <div className="space-y-4 text-sm">
        {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div> : null}
        <div className="flex flex-wrap gap-2">
          <a href={projectId ? exportZipUrl(projectId, false) : "#"} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50">
            Download workspace ZIP
          </a>
          <a href={projectId ? exportZipUrl(projectId, true) : "#"} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50">
            Download dist ZIP
          </a>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          <input value={owner} onChange={(event) => setOwner(event.target.value)} className="rounded-lg border border-zinc-200 px-3 py-2 text-xs" placeholder="GitHub owner" />
          <input value={repo} onChange={(event) => setRepo(event.target.value)} className="rounded-lg border border-zinc-200 px-3 py-2 text-xs" placeholder="repo name" />
          <button type="button" onClick={() => void exportGitHub()} disabled={!projectId || loading || !owner || !repo} className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-medium text-white disabled:bg-zinc-400">
            Export GitHub
          </button>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          <select value={provider} onChange={(event) => setProvider(event.target.value as "vercel" | "netlify" | "cloudflare")} className="rounded-lg border border-zinc-200 px-3 py-2 text-xs">
            <option value="vercel">Vercel</option>
            <option value="netlify">Netlify</option>
            <option value="cloudflare">Cloudflare Pages</option>
          </select>
          <input value={projectName} onChange={(event) => setProjectName(event.target.value)} className="rounded-lg border border-zinc-200 px-3 py-2 text-xs" placeholder="project/site name" />
          <button type="button" onClick={() => void deploy()} disabled={!projectId || loading || !canDeploy} className="rounded-lg bg-violet-700 px-3 py-2 text-xs font-medium text-white disabled:bg-violet-300">
            Deploy
          </button>
        </div>
        {!canDeploy ? <p className="text-xs text-amber-700">Backend verification must pass before deploy.</p> : null}
        {deployments.length > 0 ? (
          <div className="space-y-2">
            {deployments.slice(0, 8).map((deployment) => (
              <div key={deployment.id} className="rounded-lg border border-zinc-200 px-3 py-2 text-xs">
                <p className="font-medium text-zinc-800">{deployment.provider} · {deployment.status}</p>
                <p className="mt-1 text-zinc-500">{deployment.message}</p>
                {deployment.url ? <a href={deployment.url} target="_blank" rel="noreferrer" className="mt-1 block text-violet-700 underline">{deployment.url}</a> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
  );

  if (!chrome) {
    return content;
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-4 py-3">
        <h2 className="text-sm font-medium text-zinc-800">Export / Deploy</h2>
        <p className="mt-1 text-xs text-zinc-500">Download ZIP, export to GitHub, or deploy to real providers via backend tokens.</p>
      </div>
      <div className="p-4">
        {content}
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";

import { cancelJob, listJobs, type ProjectJob } from "@/lib/api";

type JobPanelProps = {
  projectId: string | null;
  compact?: boolean;
};

function statusClass(status: ProjectJob["status"]) {
  if (status === "succeeded") {
    return "bg-emerald-100 text-emerald-800";
  }
  if (status === "failed" || status === "cancelled") {
    return "bg-red-100 text-red-700";
  }
  if (status === "running" || status === "queued") {
    return "bg-amber-100 text-amber-800";
  }
  return "bg-zinc-100 text-zinc-500";
}

export function JobPanel({ projectId, compact = false }: JobPanelProps) {
  const [jobs, setJobs] = useState<ProjectJob[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setJobs([]);
      return;
    }
    try {
      setError(null);
      setJobs(await listJobs(projectId));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to load jobs");
    }
  }, [projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    const interval = window.setInterval(() => {
      void refresh();
    }, 2500);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [refresh]);

  async function cancel(jobId: string) {
    if (!projectId) {
      return;
    }
    await cancelJob(projectId, jobId).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Unable to cancel job");
    });
    await refresh();
  }

  return (
    <div className={compact ? "bg-white" : "rounded-xl border border-zinc-200 bg-white shadow-sm"}>
      <div className={`flex items-center justify-between gap-3 ${compact ? "pb-3" : "border-b border-zinc-200 px-4 py-3"}`}>
        <div>
          <h2 className="text-sm font-medium text-zinc-800">Jobs / Artifacts</h2>
          <p className="mt-1 text-xs text-zinc-500">Progress, logs, and artifacts for long-running tasks.</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
        >
          Refresh
        </button>
      </div>
      <div className={compact ? "space-y-3 text-sm" : "space-y-3 p-4 text-sm"}>
        {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div> : null}
        {jobs.length === 0 ? (
          <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500">No jobs yet.</p>
        ) : (
          <div className="space-y-3">
            {jobs.slice(0, 12).map((job) => (
              <details key={job.id} className="overflow-hidden rounded-lg border border-zinc-200" open={job.status === "running"}>
                <summary className="cursor-pointer bg-zinc-50 px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-medium text-zinc-800">{job.title || job.type}</span>
                      <span className="ml-2 font-mono text-xs text-zinc-400">{job.id}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(job.status)}`}>{job.status}</span>
                      <span className="font-mono text-xs text-zinc-500">{job.progress}%</span>
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-200">
                    <div className="h-full rounded-full bg-violet-600" style={{ width: `${job.progress}%` }} />
                  </div>
                </summary>
                <div className="space-y-3 p-3">
                  {job.error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{job.error}</div> : null}
                  {job.logs.length > 0 ? (
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-950 p-3 text-xs leading-5 text-zinc-100">
                      {job.logs.map((log) => `[${log.level}] ${log.message}`).join("\n")}
                    </pre>
                  ) : null}
                  {job.artifacts.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {job.artifacts.map((artifact) => (
                        <a
                          key={artifact.id}
                          href={artifact.url ?? "#"}
                          target={artifact.url ? "_blank" : undefined}
                          rel="noreferrer"
                          className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-700"
                        >
                          {artifact.type}: {artifact.name}
                        </a>
                      ))}
                    </div>
                  ) : null}
                  {(job.status === "running" || job.status === "queued") ? (
                    <button
                      type="button"
                      onClick={() => void cancel(job.id)}
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

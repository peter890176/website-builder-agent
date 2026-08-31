"use client";

import type { AgentRunResponse } from "@/lib/api";

type AgentApprovalCardProps = {
  run: AgentRunResponse | null;
  loading: boolean;
  onDecision: (approved: boolean) => void;
};

export function AgentApprovalCard({ run, loading, onDecision }: AgentApprovalCardProps) {
  const action = run?.interrupt;
  if (!run || run.status !== "interrupted" || !action) {
    return null;
  }

  const packages = action.packages ?? [];
  const devPackages = action.dev_packages ?? [];
  const isDependencyInstall = action.kind === "dependency_install";

  return (
    <section
      aria-labelledby="agent-approval-title"
      className="rounded-xl border border-amber-300/70 bg-amber-50 p-4 text-zinc-900 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-sm text-amber-800">
          !
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700">Action waiting for approval</p>
          <h3 id="agent-approval-title" className="mt-1 text-sm font-semibold text-zinc-900">
            {isDependencyInstall ? "Install additional packages" : "Review a protected change"}
          </h3>
          <p className="mt-1 text-xs leading-5 text-zinc-600">
            {isDependencyInstall
              ? "Generation is paused while you review the packages selected for this website. You can still inspect files, errors, logs, and history before deciding."
              : "Generation is paused before a protected project change. You can inspect the rest of the workspace before deciding."}
          </p>
        </div>
      </div>

      {isDependencyInstall ? (
        <details className="mt-3 rounded-lg border border-amber-200 bg-white/80 px-3 py-2 open:pb-3">
          <summary className="cursor-pointer text-xs font-medium text-amber-900">
            Review {packages.length + devPackages.length} package{packages.length + devPackages.length === 1 ? "" : "s"}
          </summary>
          <div className="mt-3 space-y-2">
            {packages.map((name) => (
              <div key={`runtime-${name}`} className="flex items-center justify-between gap-3 rounded-lg bg-zinc-50 px-3 py-2">
                <span className="break-all font-mono text-xs text-zinc-800">{name}</span>
                <span className="shrink-0 rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] font-medium text-cyan-700">website</span>
              </div>
            ))}
            {devPackages.map((name) => (
              <div key={`dev-${name}`} className="flex items-center justify-between gap-3 rounded-lg bg-zinc-50 px-3 py-2">
                <span className="break-all font-mono text-xs text-zinc-800">{name}</span>
                <span className="shrink-0 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700">development</span>
              </div>
            ))}
            <p className="text-[11px] leading-5 text-zinc-500">This updates package.json and the lockfile. Your current agent progress is saved.</p>
          </div>
        </details>
      ) : null}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          disabled={loading}
          onClick={() => onDecision(false)}
          className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-medium text-amber-900 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Stop this run
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => onDecision(true)}
          className="rounded-lg bg-amber-700 px-3 py-2 text-xs font-medium text-white transition hover:bg-amber-800 disabled:cursor-not-allowed disabled:bg-amber-300"
        >
          {loading ? "Continuing..." : isDependencyInstall ? "Install and continue" : "Approve and continue"}
        </button>
      </div>
    </section>
  );
}

"use client";

import { FormEvent, useState } from "react";

import { AppSelect } from "@/components/AppSelect";
import {
  resumeAgentRun,
  startAgentRun,
  type AgentRunResponse,
  type ChatMode,
} from "@/lib/api";

type AgentRunPanelProps = {
  projectId: string | null;
  compact?: boolean;
  onCompleted?: () => void | Promise<void>;
};

export function AgentRunPanel({ projectId, compact = false, onCompleted }: AgentRunPanelProps) {
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<ChatMode>("auto");
  const [run, setRun] = useState<AgentRunResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function finish(next: AgentRunResponse) {
    setRun(next);
    if (next.status === "completed") {
      await onCompleted?.();
    }
  }

  async function start(event: FormEvent) {
    event.preventDefault();
    if (!projectId || !message.trim()) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      await finish(await startAgentRun(projectId, message.trim(), mode, true));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to start the agent run");
    } finally {
      setLoading(false);
    }
  }

  async function decide(approved: boolean) {
    if (!projectId || !run) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      await finish(await resumeAgentRun(projectId, run.run_id, approved));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to resume the agent run");
    } finally {
      setLoading(false);
    }
  }

  const interrupt = run?.interrupt;
  const details = interrupt?.kind === "dependency_install"
    ? [...(interrupt.packages ?? []), ...(interrupt.dev_packages ?? [])].join(", ")
    : interrupt?.error;

  return (
    <section className={`rounded-lg border border-zinc-200 bg-white ${compact ? "p-3" : "p-4"}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-800">Durable Agent Run</h3>
          <p className="mt-1 text-xs text-zinc-500">SQLite checkpoints and human approval before dependencies or repairs.</p>
        </div>
        {run ? (
          <span className="rounded-full bg-zinc-100 px-2 py-1 text-[11px] font-medium text-zinc-600">
            {run.status}
          </span>
        ) : null}
      </div>

      <form className="space-y-2" onSubmit={start}>
        <textarea
          className="min-h-20 w-full resize-y rounded-md border border-zinc-200 px-3 py-2 text-xs text-zinc-800 outline-none focus:border-zinc-400"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Describe a new website or an edit to run through the full LangGraph workflow."
          disabled={loading}
        />
        <div className="flex gap-2">
          <AppSelect
            className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-700"
            value={mode}
            onValueChange={(value) => setMode(value as ChatMode)}
            options={[
              { value: "auto", label: "Auto" },
              { value: "generate", label: "Generate" },
              { value: "edit", label: "Edit" },
            ]}
            ariaLabel="Agent workflow mode"
            disabled={loading}
          />
          <button
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            type="submit"
            disabled={loading || !projectId || !message.trim()}
          >
            {loading ? "Running..." : "Start verified run"}
          </button>
        </div>
      </form>

      {interrupt ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-semibold text-amber-900">{interrupt.question}</p>
          {details ? <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap text-[11px] text-amber-800">{details}</pre> : null}
          <div className="mt-3 flex gap-2">
            <button className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white" disabled={loading} onClick={() => void decide(true)}>
              Approve and resume
            </button>
            <button className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900" disabled={loading} onClick={() => void decide(false)}>
              Reject
            </button>
          </div>
        </div>
      ) : null}

      {run?.status === "completed" ? (
        <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          Completed with {run.fix_attempts} repair attempt(s). Checkpoint: {run.run_id.slice(0, 8)}
        </p>
      ) : null}
      {run?.status === "failed" ? <p className="mt-3 text-xs text-red-600">{run.error || "Agent run failed"}</p> : null}
      {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}
    </section>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";

import {
  compareSnapshots,
  createSnapshot,
  deleteSnapshot,
  getProjectHistory,
  listSnapshots,
  restoreSnapshot,
  type HistoryEvent,
  type ProjectSnapshot,
  type SnapshotCompareResponse,
} from "@/lib/api";

type HistoryPanelProps = {
  projectId: string | null;
  prompt: string;
  onRestore: (files: { path: string; content: string }[]) => Promise<void>;
  chrome?: boolean;
};

export function HistoryPanel({ projectId, prompt, onRestore, chrome = true }: HistoryPanelProps) {
  const [snapshots, setSnapshots] = useState<ProjectSnapshot[]>([]);
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [compareFrom, setCompareFrom] = useState("");
  const [compareTo, setCompareTo] = useState("");
  const [comparison, setComparison] = useState<SnapshotCompareResponse | null>(null);
  const [snapshotLabel, setSnapshotLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<ProjectSnapshot | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) {
      return;
    }
    setError(null);
    const [nextSnapshots, nextEvents] = await Promise.all([
      listSnapshots(projectId),
      getProjectHistory(projectId),
    ]);
    setSnapshots(nextSnapshots);
    setEvents(nextEvents);
  }, [projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh().catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function createManualSnapshot() {
    if (!projectId) {
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const label = snapshotLabel.trim() || "Manual snapshot";
      await createSnapshot(projectId, {
        label,
        kind: "manual",
        prompt,
        notes: `Created from History panel${snapshotLabel.trim() ? "" : " without a custom label"}`,
      });
      setSnapshotLabel("");
      setNotice(`Snapshot "${label}" created.`);
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to create snapshot");
    } finally {
      setLoading(false);
    }
  }

  async function restore(snapshot: ProjectSnapshot) {
    if (!projectId) {
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const response = await restoreSnapshot(projectId, snapshot.id);
      await onRestore(response.changed_files);
      setNotice(`Restored "${snapshot.label}" and synced ${response.changed_files.length} files.`);
      setRestoreTarget(null);
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to restore snapshot");
    } finally {
      setLoading(false);
    }
  }

  async function removeSnapshot(snapshot: ProjectSnapshot) {
    if (!projectId || !window.confirm(`Delete snapshot "${snapshot.label}"? This cannot be undone.`)) {
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      await deleteSnapshot(projectId, snapshot.id);
      if (compareFrom === snapshot.id) {
        setCompareFrom("");
        setComparison(null);
      }
      if (compareTo === snapshot.id) {
        setCompareTo("");
        setComparison(null);
      }
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to delete snapshot");
    } finally {
      setLoading(false);
    }
  }

  async function compare() {
    if (!projectId || !compareFrom || !compareTo) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setComparison(await compareSnapshots(projectId, compareFrom, compareTo));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to compare snapshots");
    } finally {
      setLoading(false);
    }
  }

  const content = (
    <>
      <div className={`flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between ${
        chrome ? "border-b border-zinc-200 px-4 py-3" : "mb-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3"
      }`}>
        {chrome ? (
          <div>
            <h2 className="text-sm font-medium text-zinc-800">Version History</h2>
            <p className="mt-1 text-xs text-zinc-500">Snapshots, prompt history, edit history, and rollback.</p>
          </div>
        ) : (
          <div>
            <p className="text-xs font-medium text-zinc-700">Create Named Snapshot</p>
            <p className="mt-1 text-xs text-zinc-500">Enter a name to make comparison and restore easier later.</p>
          </div>
        )}
        <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
          <input
            value={snapshotLabel}
            onChange={(event) => setSnapshotLabel(event.target.value)}
            className="min-w-0 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs outline-none ring-zinc-400 focus:ring-2 sm:w-56"
            placeholder="Snapshot name, for example: first homepage draft"
            disabled={!projectId || loading}
            maxLength={80}
          />
          <button type="button" onClick={() => void createManualSnapshot()} disabled={!projectId || loading} className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:bg-zinc-400">
            Create Snapshot
          </button>
        </div>
      </div>
      <div className={chrome ? "space-y-3 p-4 text-sm" : "space-y-3 text-sm"}>
        {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div> : null}
        {notice ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</div> : null}
        <div className="grid gap-3 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-medium text-zinc-500">Snapshots</p>
            <div className="max-h-56 space-y-2 overflow-auto">
              {snapshots.length ? snapshots.map((snapshot) => (
                <div key={snapshot.id} className="rounded-lg border border-zinc-200 px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-zinc-800">{snapshot.label}</p>
                      <p className="text-xs text-zinc-500">{snapshot.kind} · {snapshot.file_count} files · {snapshot.verified ? "verified" : "unverified"}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button type="button" onClick={() => setRestoreTarget(snapshot)} disabled={loading} className="text-xs font-medium text-cyan-700 hover:underline disabled:text-zinc-300">
                        Restore
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeSnapshot(snapshot)}
                        disabled={loading}
                        className="rounded-md p-1 text-red-700 transition hover:bg-red-50 disabled:text-zinc-300"
                        aria-label={`Delete snapshot ${snapshot.label}`}
                        title="Delete"
                      >
                        <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                          <path
                            fillRule="evenodd"
                            d="M8.5 3a1.5 1.5 0 0 0-1.415 1H4.25a.75.75 0 0 0 0 1.5h11.5a.75.75 0 0 0 0-1.5h-2.835A1.5 1.5 0 0 0 11.5 3h-3Zm-2 4a.75.75 0 0 1 .75.75v6.5a.75.75 0 0 1-1.5 0v-6.5A.75.75 0 0 1 6.5 7Zm3.5.75a.75.75 0 0 0-1.5 0v6.5a.75.75 0 0 0 1.5 0v-6.5Zm2.75-.75a.75.75 0 0 1 .75.75v6.5a.75.75 0 0 1-1.5 0v-6.5a.75.75 0 0 1 .75-.75ZM5.5 6.5a.75.75 0 0 0-.748.807l.653 8.5A2.25 2.25 0 0 0 7.648 18h4.704a2.25 2.25 0 0 0 2.243-2.193l.653-8.5a.75.75 0 0 0-.748-.807h-9Z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              )) : <p className="text-xs text-zinc-500">No snapshots yet.</p>}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-zinc-500">Events</p>
            <div className="max-h-56 space-y-2 overflow-auto">
              {events.length ? events.slice(0, 20).map((event) => (
                <div key={event.id} className="rounded-lg border border-zinc-200 px-3 py-2">
                  <p className="text-zinc-800">{event.message}</p>
                  <p className="text-xs text-zinc-500">{event.type} · {new Date(event.created_at).toLocaleString()}</p>
                </div>
              )) : <p className="text-xs text-zinc-500">No history events yet.</p>}
            </div>
          </div>
        </div>
        {snapshots.length >= 2 ? (
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
            <p className="mb-2 text-xs font-medium text-zinc-500">Compare snapshots</p>
            <div className="grid gap-2 sm:grid-cols-3">
              <select value={compareFrom} onChange={(event) => setCompareFrom(event.target.value)} className="rounded-lg border border-zinc-200 px-2 py-1.5 text-xs">
                <option value="">From</option>
                {snapshots.map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{snapshot.label}</option>)}
              </select>
              <select value={compareTo} onChange={(event) => setCompareTo(event.target.value)} className="rounded-lg border border-zinc-200 px-2 py-1.5 text-xs">
                <option value="">To</option>
                {snapshots.map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{snapshot.label}</option>)}
              </select>
              <button type="button" onClick={() => void compare()} disabled={loading || !compareFrom || !compareTo} className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:bg-zinc-400">
                Compare
              </button>
            </div>
            {comparison ? (
              <div className="mt-3 max-h-40 overflow-auto rounded-lg bg-white p-2">
                {comparison.files.length > 0 ? comparison.files.map((file) => (
                  <div key={`${file.path}-${file.change_type}`} className="font-mono text-xs text-zinc-600">
                    {file.change_type} {file.path}
                  </div>
                )) : <p className="text-xs text-zinc-500">No file changes.</p>}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {restoreTarget ? (
        <div
          className="fixed inset-0 z-[70] flex cursor-pointer items-center justify-center bg-zinc-950/80 px-4 py-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm snapshot restore"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !loading) {
              setRestoreTarget(null);
            }
          }}
        >
          <div className="w-full max-w-md cursor-default rounded-2xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl">
            <h3 className="text-sm font-semibold text-zinc-100">Restore Snapshot</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-300">
              Restore &quot;{restoreTarget.label}&quot;? Current editable project files will be overwritten by this version.
            </p>
            <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-400">
              {restoreTarget.kind} - {restoreTarget.file_count} files - {restoreTarget.verified ? "verified" : "unverified"}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRestoreTarget(null)}
                disabled={loading}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:text-zinc-500"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void restore(restoreTarget)}
                disabled={loading}
                className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-cyan-500 disabled:bg-zinc-600"
              >
                {loading ? "Restoring..." : "Restore"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );

  if (!chrome) {
    return <>{content}</>;
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      {content}
    </div>
  );
}

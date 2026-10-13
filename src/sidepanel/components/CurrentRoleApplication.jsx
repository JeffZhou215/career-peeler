import { useEffect, useState } from "react";
import { cleanJobTitle } from "../lib/format";
import { Sheet } from "./Sheet";

export function CurrentRoleApplication({ save, running, setStatusMessage, onStarted, onOpenSetup }) {
  const [tab, setTab] = useState(null);
  const [prepared, setPrepared] = useState(null);
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let windowId;
    let cancelled = false;
    let revision = 0;
    const refresh = async () => {
      const request = ++revision;
      const tabs = await chrome.tabs.query({ active: true, windowId });
      if (!cancelled && request === revision) setTab(tabs[0] || null);
    };
    const activated = info => { if (info.windowId === windowId) refresh().catch(console.error); };
    const updated = (_id, changes, updatedTab) => {
      if (updatedTab.windowId === windowId && updatedTab.active && (changes.url || changes.title)) refresh().catch(console.error);
    };
    chrome.windows.getCurrent().then(window => {
      if (cancelled) return;
      windowId = window.id;
      chrome.tabs.onActivated.addListener(activated);
      chrome.tabs.onUpdated.addListener(updated);
      return refresh();
    }).catch(console.error);
    return () => {
      cancelled = true;
      chrome.tabs.onActivated.removeListener(activated);
      chrome.tabs.onUpdated.removeListener(updated);
    };
  }, []);

  async function review() {
    setBusy(true); setError(""); setConfirmed(false);
    try {
      const profile = await save();
      const response = await chrome.runtime.sendMessage({ type: "APPLE_CAREERS_PREPARE_CURRENT_ROLE", tabId: tab.id, userProfile: profile });
      if (!response?.ok) throw new Error(response?.error || "This role could not be reviewed.");
      setPrepared(response.data); setOpen(true);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function apply() {
    setBusy(true); setError("");
    try {
      const profile = await save();
      const response = await chrome.runtime.sendMessage({ type: "APPLE_CAREERS_APPLY_CURRENT_ROLE", tabId: prepared.tabId,
        userProfile: profile, token: prepared.token, confirmed });
      if (!response?.ok) throw new Error(response?.error || "This application could not be started.");
      setOpen(false);
      setStatusMessage("Checking available slots, then completing this role's application. Progress and any failure appear in Activity.");
      onStarted();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  let isJobPage = false;
  try {
    const url = new URL(tab?.url);
    isJobPage = url.origin === "https://jobs.apple.com" && /\/details\//i.test(url.pathname);
  } catch (_) { /* The active tab may be an internal Chrome page. */ }

  if (!isJobPage && !open) return null;
  return <section className="current-role-application">
    <div className="compact-progress"><span><strong>Current Role</strong><span className="compact-role-meta">{cleanJobTitle(tab?.title)}</span></span>
      <button type="button" className="secondary" disabled={busy || running || open || !isJobPage} onClick={review}>{busy && !open ? "Preparing…" : "Apply This Role"}</button>
    </div>
    {error && !open && <p role="alert" className="submitted-history-error">{error}</p>}
    <Sheet open={open} onClose={() => setOpen(false)} title="Apply This Role" busy={busy}>
      <ul className="sheet-job-list"><li><a href={prepared?.job.url} target="_blank" rel="noopener noreferrer">{prepared?.job.title}</a>
        <span className="compact-role-meta">{prepared?.job.jobId}{Number.isFinite(prepared?.job.score) ? ` · ${prepared.job.score}% Fit` : " · No Current Match Score"}</span>
        {prepared?.job.reason && <p className="muted">{prepared.job.reason}</p>}
        {!!prepared?.job.blockers?.length && <details className="compact-fold"><summary>Match Concerns</summary><div className="compact-fold-body"><ul>{prepared.job.blockers.map((reason, index) => <li key={index}>{reason}</li>)}</ul></div></details>}
      </li></ul>
      <p className="muted">Completes The Application Stages And Submits This Role Using Your Saved Profile. Available Slots Are Checked First. If A Step Needs Your Attention, The Application Stays Open.</p>
      <label className="checkbox-row consent-row"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /><span>I Reviewed This Role And Allow Its Application To Be Submitted</span></label>
      <div className="compact-actions"><button type="button" className="secondary" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
        <button type="button" className="primary" disabled={busy || running || !confirmed} onClick={apply}>{busy ? "Starting…" : "Confirm And Apply"}</button></div>
      {error && <p role="alert" className="submitted-history-error">{error}</p>}
      <button type="button" className="text-action" disabled={busy} onClick={() => { setOpen(false); onOpenSetup?.(); }}>Open Setup</button>
    </Sheet>
  </section>;
}

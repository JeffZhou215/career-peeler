import { useState } from "react";
import { HelpTooltip } from "./components/HelpTooltip";
import { useSubmissionSyncStatus } from "./hooks/useSubmissionSyncStatus";
import { useUserProfile } from "./hooks/useUserProfile";
import { SubmittedApplicationsSection } from "./components/SubmittedApplicationsSection";
import { RankedJobsSection } from "./components/RankedJobsSection";
import { AppleSetupSection } from "./components/AppleSetupSection";
import { AppleActivity } from "./components/AppleActivity";
import { ExtensionBrand } from "./components/ExtensionBrand";
import { formatRelativeTime } from "./lib/format";

function TabIcon({ tab }) {
  const paths = { jobs: <><rect x="3" y="7" width="18" height="14" rx="3"/><path d="M8 7V4h8v3M3 12h18M10 12v3h4v-3"/></>,
    submissions: <><path d="m3 6 2 2 3-4m-5 9 2 2 3-4m-5 9 2 2 3-4M11 6h10M11 13h10M11 20h10"/></>,
    setup: <><circle cx="12" cy="7" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/></> };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">{paths[tab]}</svg>;
}
export function App() {
  const { profile, loaded, save } = useUserProfile();
  const { status: syncStatus, now: syncNow } = useSubmissionSyncStatus();
  const [tab, setTab] = useState("jobs");
  const [statusMessage, setStatusMessage] = useState("");
  const [queueSummary, setQueueSummary] = useState(null);
  if (!loaded) return null;
  const capacity = queueSummary?.capacity;
  const countVerified = capacity?.known && syncStatus.state !== "failed";
  const cachedCount = countVerified && (syncStatus.state !== "synced" || syncNow - Number(syncStatus.lastSuccessAt || 0) >= 60000);
  return <main className="app ios-app">
    <div className="ios-chrome"><ExtensionBrand />
      <div className="capacity-strip" aria-live="polite">
        <div className="capacity-metric"><span className="capacity-metric-label">Submitted</span>
          <strong>{countVerified ? `${capacity.submitted} / 50` : "Not Verified"}</strong>
          {cachedCount && <span className="capacity-cache">Cached Count</span>}
        </div>
        <div className="capacity-metric"><span className="capacity-metric-label">Available Slots</span>
          <strong aria-label={countVerified ? undefined : "Not Verified"}>{countVerified ? capacity.remaining : "—"}</strong>
        </div>
        <div className="capacity-metric"><span className="capacity-metric-label">Application Queue</span>
          <strong>{queueSummary?.queued?.length || 0} Jobs</strong>
        </div>
        <HelpTooltip label="Submission Capacity" text={`Uses the latest verified count plus confirmed new applications and pending reservations. Checked ${capacity?.checkedAt ? formatRelativeTime(capacity.checkedAt) : "before applying"}. Automatic checks read the current Active Submissions page without navigating. Explicit Sync verifies all pages. Apple may exempt some roles from its cap.`} />
      </div>
    </div>
    <div className="ios-workspace">
      <section role="tabpanel" id="jobs-panel" aria-labelledby="jobs-tab" hidden={tab !== "jobs"}><RankedJobsSection embedded profile={profile} save={save} setStatusMessage={setStatusMessage} onSummaryChange={setQueueSummary} onOpenSetup={() => setTab("setup")} /></section>
      <section role="tabpanel" id="submissions-panel" aria-labelledby="submissions-tab" hidden={tab !== "submissions"}><SubmittedApplicationsSection embedded syncStatus={syncStatus} syncNow={syncNow} profile={profile} setStatusMessage={setStatusMessage} /></section>
      <section role="tabpanel" id="setup-panel" aria-labelledby="setup-tab" hidden={tab !== "setup"}><AppleSetupSection profile={profile} save={save} /></section>
      {statusMessage && <section className="status compact-status" aria-live="polite"><span>{statusMessage}</span><button type="button" className="status-dismiss" aria-label="Dismiss Status" onClick={() => setStatusMessage("")}>×</button></section>}
      <AppleActivity view={queueSummary} />
    </div>
    <nav className="ios-tabbar" role="tablist" aria-label="Apple Careers Views">{[["jobs","Jobs"],["submissions","Submissions"],["setup","Setup"]].map(([key,label]) =>
      <button key={key} id={`${key}-tab`} role="tab" aria-selected={tab === key} aria-controls={`${key}-panel`} type="button" onClick={() => setTab(key)}><TabIcon tab={key} /><span>{label}</span></button>)}</nav>
  </main>;
}

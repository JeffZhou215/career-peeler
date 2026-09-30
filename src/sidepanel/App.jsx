import { useState } from "react";
import { HelpTooltip } from "./components/HelpTooltip";
import { KnownSitesSection } from "./components/KnownSitesSection";
import { GenericAutofillSection } from "./components/GenericAutofillSection";
import { useUserProfile } from "./hooks/useUserProfile";
import { useScanStatus } from "./hooks/useScanStatus";
import { SubmittedApplicationsSection } from "./components/SubmittedApplicationsSection";
import { RankedJobsSection } from "./components/RankedJobsSection";

export function App() {
  const { profile, loaded, save } = useUserProfile();
  const { status, refresh: refreshScanStatus } = useScanStatus();
  const [statusMessage, setStatusMessage] = useState("");
  const [queueSummary, setQueueSummary] = useState(null);

  if (!loaded) {
    return null;
  }

  return (
    <main className="app">
      <header>
        <p className="eyebrow">Career Peeler</p>
        <h1>
          Job Application Assistant
          <HelpTooltip label="Job Application Assistant" text="Open a function to review submissions, rank new jobs, manage settings or inspect activity. Only one main function is expanded at a time." />
        </h1>
      </header>

      <div className="capacity-strip" aria-live="polite">
        {queueSummary?.capacity?.known ? <><span><strong>{queueSummary.capacity.submitted}</strong> Submitted</span><span><strong>{queueSummary.capacity.remaining}</strong> Open Slots</span></> : <span>Count Not Verified</span>}
        <span><strong>{queueSummary?.queued || 0}</strong> Queued</span>
        <HelpTooltip label="Submission Capacity" text="Counts visible active submissions, with a conservative 50-submission target. Refresh Submission Count is in Ranked Job Queue → Scan Details. The count is checked again before applying; Apple may exempt some roles from its cap." />
      </div>
      <SubmittedApplicationsSection profile={profile} setStatusMessage={setStatusMessage} />
      <RankedJobsSection profile={profile} save={save} setStatusMessage={setStatusMessage} onSummaryChange={setQueueSummary} />

      <KnownSitesSection
        profile={profile}
        save={save}
        status={status}
        refreshScanStatus={refreshScanStatus}
        setStatusMessage={setStatusMessage}
      />

      {statusMessage && <section className="status compact-status" aria-live="polite">
        <span>{statusMessage}</span><button type="button" className="status-dismiss" aria-label="Dismiss Status" onClick={() => setStatusMessage("")}>×</button>
      </section>}

      <GenericAutofillSection profile={profile} save={save} setStatusMessage={setStatusMessage} />
    </main>
  );
}

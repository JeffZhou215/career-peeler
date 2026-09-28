import { useState } from "react";
import { HelpTooltip } from "./components/HelpTooltip";
import { KnownSitesSection } from "./components/KnownSitesSection";
import { GenericAutofillSection } from "./components/GenericAutofillSection";
import { useUserProfile } from "./hooks/useUserProfile";
import { useScanStatus } from "./hooks/useScanStatus";
import { SubmittedApplicationsSection } from "./components/SubmittedApplicationsSection";

export function App() {
  const { profile, loaded, save } = useUserProfile();
  const { status, refresh: refreshScanStatus } = useScanStatus();
  const [statusMessage, setStatusMessage] = useState(
    "Open a supported careers jobs list page, then click Scan Visible Job List."
  );

  if (!loaded) {
    return null;
  }

  return (
    <main className="app">
      <header>
        <p className="eyebrow">Career Peeler</p>
        <h1>
          Job Application Assistant
          <HelpTooltip text="Pick a mode below. Only one is open at a time -- click the other's header to switch." />
        </h1>
      </header>

      <SubmittedApplicationsSection profile={profile} setStatusMessage={setStatusMessage} />

      <KnownSitesSection
        profile={profile}
        save={save}
        status={status}
        refreshScanStatus={refreshScanStatus}
        setStatusMessage={setStatusMessage}
      />

      <section className="status" aria-live="polite">
        {statusMessage}
      </section>

      <GenericAutofillSection profile={profile} save={save} setStatusMessage={setStatusMessage} />
    </main>
  );
}

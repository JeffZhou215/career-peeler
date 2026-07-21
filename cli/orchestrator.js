// Node/Playwright port of background.js's scan/apply orchestration (startScan, runScanLoop,
// scanJobLink, scanCurrentApplicationPage, runApplicationWorkflow, stopScan, clearHistory). The
// control flow -- retry loops, attempt caps, status transitions -- is ported 1:1; only the
// underlying primitives change: chrome.tabs.create/remove/query -> context.newPage()/page.close()/
// context.pages(), and sendMessageWithFallback -> direct page.evaluate() calls via cli/browser.js
// (no inject-on-failure dance needed, since content.js is guaranteed present via addInitScript).
const core = require("../lib/core.js");
const browser = require("./browser.js");

const PAGE_SETTLE_DELAY_MS = 1500;
const PAGE_LOAD_TIMEOUT_MS = 25000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runApplicationWorkflow(context, store, page, options = {}) {
  const closeOnDone = options.closeOnDone !== false;
  const stopIfScanStopped = Boolean(options.stopIfScanStopped);
  const jobContext = options.jobContext || null;
  const originalPage = page;
  let workflowPage = page;

  const siteConfig = core.getSiteConfig(workflowPage.url());
  const jobId = core.getJobIdFromUrl(workflowPage.url());

  if (!siteConfig) {
    return {
      ok: false,
      error: `Expected an Apple, TikTok, or ByteDance careers job/application page, but the current URL is ${workflowPage.url() || "unknown"}.`
    };
  }

  const steps = [];
  const attempts = [];
  const ownedPages = new Set();

  const cleanupWorkflowPages = async () => {
    if (!closeOnDone) {
      return;
    }

    for (const ownedPage of ownedPages) {
      if (ownedPage !== originalPage) {
        await ownedPage.close().catch(() => {});
      }
    }
    ownedPages.clear();
  };

  try {
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      if (stopIfScanStopped && !store.scanState.running) {
        return {
          ok: false,
          error: "Scan stopped.",
          data: {
            submitted: false,
            errorType: "stopped_by_user",
            attempts,
            steps,
            summary: "Scan was stopped; leaving the current application step as-is."
          }
        };
      }

      await browser.waitForPageLoad(workflowPage, PAGE_LOAD_TIMEOUT_MS);
      await delay(PAGE_SETTLE_DELAY_MS);

      const previousPages = new Set(context.pages());
      const data = await browser.runApplicationWorkflowStepOnPage(workflowPage).catch((error) => {
        throw new Error(error?.message || "The application workflow step failed.");
      });

      attempts.push({
        attempt,
        url: data.url,
        title: data.title,
        heading: data.heading,
        summary: data.summary,
        errorType: data.errorType || null,
        visibleActions: data.visibleActions || []
      });

      steps.push(...data.steps.map((step) => ({ ...step, attempt })));

      const openedApplication =
        data.clicked && data.steps.some((step) => step.step === "Open application flow" && step.status === "clicked");

      if (openedApplication) {
        const applicationPage = await browser.waitForApplicationPage(context, previousPages, siteConfig, jobId);
        if (applicationPage) {
          workflowPage = applicationPage;
          ownedPages.add(applicationPage);
          attempts.push({
            attempt,
            url: applicationPage.url(),
            title: await applicationPage.title().catch(() => ""),
            heading: "",
            summary: "Detected newly opened application page.",
            visibleActions: []
          });
        }
      }

      if (data.done) {
        const isFreshSubmission = !data.alreadySubmitted;

        if (isFreshSubmission && jobContext) {
          store.recordAppliedCheckpoint(jobContext);
        }

        await delay(2500);
        if (closeOnDone) {
          await workflowPage.close().catch(() => {});
          ownedPages.delete(workflowPage);
        }

        if (data.alreadySubmitted) {
          return {
            ok: true,
            data: {
              submitted: false,
              alreadySubmitted: true,
              errorType: data.errorType || "already_applied",
              attempts,
              steps,
              summary: closeOnDone
                ? "Job was already submitted and the job page was closed."
                : "Job was already submitted."
            }
          };
        }

        return {
          ok: true,
          data: {
            submitted: true,
            checkpointed: isFreshSubmission && Boolean(jobContext),
            attempts,
            steps,
            summary: closeOnDone ? "Application submitted and the job page was closed." : "Application submitted."
          }
        };
      }

      if (data.pausedForReview) {
        // Leave the page open (skip cleanupWorkflowPages) so the user can see the drafted answer
        // live and submit it themselves -- unlike every other exit path here, this is not a failure.
        return {
          ok: true,
          data: {
            submitted: false,
            pausedForReview: true,
            errorType: data.errorType || "open_text_review_required",
            url: data.url,
            attempts,
            steps,
            summary: data.summary
          }
        };
      }

      if (!data.clicked) {
        await cleanupWorkflowPages();
        return {
          ok: false,
          error: data.summary || "The workflow could not find the next action.",
          data: {
            submitted: false,
            errorType: data.errorType || core.classifyWorkflowError(data.summary, { attempts, steps }),
            summary: data.summary,
            attempts,
            steps
          }
        };
      }
    }

    await cleanupWorkflowPages();
    return {
      ok: false,
      error: "The workflow hit the maximum number of steps before submission.",
      data: {
        submitted: false,
        errorType: "workflow_timeout",
        summary: "The workflow hit the maximum number of steps before submission.",
        attempts,
        steps
      }
    };
  } catch (error) {
    await cleanupWorkflowPages();
    throw error;
  }
}

async function scanJobLink(context, store, link) {
  let detailPage;
  const siteConfig = core.SITE_CONFIGS[link.site] || core.getSiteConfig(link.url);
  const site = siteConfig?.id || link.site || "unknown";
  const siteLabel = siteConfig?.label || link.siteLabel || core.getSiteLabel(link.url);

  try {
    if (link.alreadyAppliedFromList) {
      store.saveJobRecord(
        {
          site,
          siteLabel,
          jobId: link.jobId,
          title: link.title,
          url: link.url,
          decision: "Already submitted",
          reason: "List page shows this role has already been applied/submitted.",
          alreadySubmitted: true
        },
        "submitted"
      );
      core.incrementStatsForStatus(store.scanState.stats, "submitted");
      store.scanState.scanned += 1;
      store.saveScanState();
      return;
    }

    const titleHardSkipReason = core.getHardSkipTitleReason(link.title);
    if (titleHardSkipReason) {
      store.saveJobRecord(
        { site, siteLabel, jobId: link.jobId, title: link.title, url: link.url, decision: "Likely skip", reason: titleHardSkipReason },
        "likely_skip"
      );
      core.incrementStatsForStatus(store.scanState.stats, "likely_skip");
      store.scanState.scanned += 1;
      store.saveScanState();
      return;
    }

    store.updateScanState({ phase: "Scanning job detail", currentJob: link, lastError: null });

    detailPage = await browser.openPage(context, link.url);
    await browser.waitForPageLoad(detailPage, PAGE_LOAD_TIMEOUT_MS);
    await delay(PAGE_SETTLE_DELAY_MS);

    const extracted = await browser
      .extractJobDetailsOnPage(detailPage, {
        userYearsOfExperience: store.scanState.userProfile?.userYearsOfExperience,
        noMatchKeywords: store.scanState.userProfile?.noMatchKeywords
      })
      .catch(() => {
        throw new Error("Could not extract the job detail page.");
      });

    let job = await core.applyLlmMatch(extracted, store.scanState.userProfile, { onError: store.rememberError });
    job = { ...job, site: job.site || site, siteLabel: job.siteLabel || siteLabel };
    job = core.applyRequiredYoeHardSkip(job, store.scanState.userProfile);
    const status = job.alreadySubmitted ? "submitted" : core.statusFromDecision(job.decision);
    let finalStatus = status;
    let applicationResult = null;
    let failureReason = null;
    let alreadyCheckpointed = false;

    if (core.shouldAutoApply(status, job, store.scanState.userProfile)) {
      store.updateScanState({ phase: "Auto-applying", currentJob: { ...link, decision: job.decision } });

      const workflowResponse = await runApplicationWorkflow(context, store, detailPage, {
        stopIfScanStopped: true,
        jobContext: { jobId: job.jobId, site: job.site, siteLabel: job.siteLabel, title: job.title, url: job.url }
      });
      applicationResult = workflowResponse.data || null;

      if (workflowResponse.ok && workflowResponse.data?.submitted) {
        finalStatus = "applied";
        alreadyCheckpointed = Boolean(workflowResponse.data?.checkpointed);

        if (!alreadyCheckpointed) {
          store.scanState.lastApplied = {
            jobId: job.jobId,
            site: job.site,
            siteLabel: job.siteLabel,
            title: job.title,
            url: job.url,
            appliedAt: new Date().toISOString()
          };
        }
      } else if (workflowResponse.ok && workflowResponse.data?.alreadySubmitted) {
        finalStatus = "submitted";
        job.errorType = workflowResponse.data.errorType || null;
      } else if (workflowResponse.ok && workflowResponse.data?.pausedForReview) {
        finalStatus = "needs_review";
        job.errorType = workflowResponse.data.errorType || "open_text_review_required";
        store.rememberError({
          type: job.errorType,
          errorType: job.errorType,
          jobId: job.jobId,
          site: job.site,
          siteLabel: job.siteLabel,
          title: job.title,
          url: workflowResponse.data.url || job.url,
          status: finalStatus,
          message: workflowResponse.data.summary,
          workflow: applicationResult,
          lastAttempt: applicationResult?.attempts?.at(-1) || null
        });
      } else {
        finalStatus = `${status}_apply_failed`;
        failureReason = workflowResponse.error || "Auto-apply workflow did not finish.";
        const errorType = core.classifyWorkflowError(failureReason, applicationResult);
        store.scanState.stats.errors += 1;
        store.scanState.lastError = failureReason;
        store.rememberError({
          type: errorType,
          errorType,
          jobId: job.jobId,
          site: job.site,
          siteLabel: job.siteLabel,
          title: job.title,
          url: job.url || link.url,
          status: finalStatus,
          message: failureReason,
          workflow: applicationResult,
          lastAttempt: applicationResult?.attempts?.at(-1) || null
        });
        store.rememberFailure({
          jobId: job.jobId,
          site: job.site,
          siteLabel: job.siteLabel,
          title: job.title,
          url: job.url,
          decision: job.decision,
          resumeMatch: job.resumeMatch,
          status: finalStatus,
          reason: failureReason,
          workflow: applicationResult
        });
        job.errorType = errorType;
      }
    }

    store.saveJobRecord({ ...job, applicationResult, failureReason, errorType: job.errorType || null }, finalStatus);
    if (!alreadyCheckpointed) {
      core.incrementStatsForStatus(store.scanState.stats, finalStatus);
    }

    store.scanState.scanned += 1;
    store.saveScanState();
  } catch (error) {
    const message = error?.message || "Could not scan a job detail page.";
    store.scanState.stats.errors += 1;
    store.scanState.lastError = message;
    store.rememberError({
      type: "scan_job_failed",
      errorType: "scan_job_failed",
      jobId: link.jobId || "unknown",
      site,
      siteLabel,
      title: link.title,
      url: link.url || (detailPage ? detailPage.url() : null),
      status: "error",
      message
    });
    store.saveScanState();
  } finally {
    if (detailPage) {
      await detailPage.close().catch(() => {});
    }

    store.scanState.currentJob = null;
    store.saveScanState();
  }
}

async function scanCurrentApplicationPage(context, store, listPage, link) {
  const siteConfig = core.SITE_CONFIGS[link.site] || core.getSiteConfig(link.url);
  const site = siteConfig?.id || link.site || "unknown";
  const siteLabel = siteConfig?.label || link.siteLabel || core.getSiteLabel(link.url);
  let job = {
    site,
    siteLabel,
    jobId: link.jobId,
    title: link.title,
    url: link.url,
    decision: "Review",
    reason: "Started from the current job/application page.",
    matchSource: "current_page"
  };
  let finalStatus = "review";
  let applicationResult = null;
  let failureReason = null;
  let alreadyCheckpointed = false;

  try {
    store.updateScanState({ phase: "Running current application page", currentJob: link, lastError: null });

    const extracted = await browser
      .extractJobDetailsOnPage(listPage, {
        userYearsOfExperience: store.scanState.userProfile?.userYearsOfExperience,
        noMatchKeywords: store.scanState.userProfile?.noMatchKeywords
      })
      .catch(() => null);

    if (extracted) {
      job = {
        ...extracted,
        site: extracted.site || site,
        siteLabel: extracted.siteLabel || siteLabel,
        decision: extracted.decision || "Review",
        reason: extracted.reason || "Started from the current job/application page.",
        matchSource: extracted.matchSource || "current_page"
      };
    }

    if (store.scanState.userProfile?.scanMode !== "auto_apply" || !store.scanState.userProfile?.autoApplyConsent) {
      store.saveJobRecord(job, finalStatus);
      core.incrementStatsForStatus(store.scanState.stats, finalStatus);
      store.scanState.scanned += 1;
      store.saveScanState();
      return;
    }

    const workflowResponse = await runApplicationWorkflow(context, store, listPage, {
      closeOnDone: false,
      stopIfScanStopped: true,
      jobContext: { jobId: job.jobId, site: job.site, siteLabel: job.siteLabel, title: job.title, url: job.url }
    });
    applicationResult = workflowResponse.data || null;

    if (workflowResponse.ok && workflowResponse.data?.submitted) {
      finalStatus = "applied";
      alreadyCheckpointed = Boolean(workflowResponse.data?.checkpointed);

      if (!alreadyCheckpointed) {
        store.scanState.lastApplied = {
          jobId: job.jobId,
          site: job.site,
          siteLabel: job.siteLabel,
          title: job.title,
          url: job.url,
          appliedAt: new Date().toISOString()
        };
      }
    } else if (workflowResponse.ok && workflowResponse.data?.alreadySubmitted) {
      finalStatus = "submitted";
      job.errorType = workflowResponse.data.errorType || null;
    } else if (workflowResponse.ok && workflowResponse.data?.pausedForReview) {
      finalStatus = "needs_review";
      job.errorType = workflowResponse.data.errorType || "open_text_review_required";
      store.rememberError({
        type: job.errorType,
        errorType: job.errorType,
        jobId: job.jobId,
        site: job.site,
        siteLabel: job.siteLabel,
        title: job.title,
        url: workflowResponse.data.url || job.url,
        status: finalStatus,
        message: workflowResponse.data.summary,
        workflow: applicationResult,
        lastAttempt: applicationResult?.attempts?.at(-1) || null
      });
    } else {
      finalStatus = "review_apply_failed";
      failureReason = workflowResponse.error || "Current application page workflow did not finish.";
      const errorType = core.classifyWorkflowError(failureReason, applicationResult);
      store.scanState.stats.errors += 1;
      store.scanState.lastError = failureReason;
      store.rememberError({
        type: errorType,
        errorType,
        jobId: job.jobId,
        site: job.site,
        siteLabel: job.siteLabel,
        title: job.title,
        url: job.url,
        status: finalStatus,
        message: failureReason,
        workflow: applicationResult,
        lastAttempt: applicationResult?.attempts?.at(-1) || null
      });
      job.errorType = errorType;
    }

    store.saveJobRecord({ ...job, applicationResult, failureReason, errorType: job.errorType || null }, finalStatus);
    if (!alreadyCheckpointed) {
      core.incrementStatsForStatus(store.scanState.stats, finalStatus);
    }
    store.scanState.scanned += 1;
    store.saveScanState();
  } catch (error) {
    const message = error?.message || "Could not run workflow on the current application page.";
    store.scanState.stats.errors += 1;
    store.scanState.lastError = message;
    store.rememberError({
      type: "current_page_scan_failed",
      errorType: "current_page_scan_failed",
      jobId: job.jobId || link.jobId || "unknown",
      site,
      siteLabel,
      title: job.title || link.title,
      url: job.url || link.url,
      status: "error",
      message,
      workflow: applicationResult,
      lastAttempt: applicationResult?.attempts?.at(-1) || null
    });
    store.saveScanState();
  } finally {
    store.scanState.currentJob = null;
    store.saveScanState();
  }
}

async function runScanLoop(context, store, listPage) {
  try {
    while (store.scanState.running) {
      store.updateScanState({ phase: "Collecting job links" });

      const collection = await browser.collectJobLinksOnPage(listPage);
      const newLinks = [];
      let skippedStored = 0;
      let skippedUnqualified = 0;

      for (const link of collection.links) {
        if (store.isLinkProcessed(link)) {
          if (store.wasStoredBeforeScan(link)) {
            skippedStored += 1;

            const priorRecord = store.getStoredJobRecord(link);
            if (store.isUnqualifiedRecord(priorRecord)) {
              skippedUnqualified += 1;
              store.rememberSkippedUnqualified({
                jobId: link.jobId || priorRecord.jobId,
                site: link.site || priorRecord.site,
                siteLabel: link.siteLabel || priorRecord.siteLabel,
                title: link.title || priorRecord.title,
                url: link.url || priorRecord.url,
                reason: priorRecord.reason || priorRecord.failureReason
              });
            }
          }
          continue;
        }

        newLinks.push(link);
      }

      store.scanState.stats.skippedStored += skippedStored;
      store.scanState.stats.skippedUnqualified += skippedUnqualified;
      const hasAlreadyVisitedListPage = store.visitedListPages.has(collection.url);

      store.scanState.listPageUrl = collection.url;
      store.scanState.site = collection.site || store.scanState.site;
      store.scanState.siteLabel = collection.siteLabel || store.scanState.siteLabel;
      store.scanState.pageCount = collection.currentPage || store.scanState.pageCount;
      store.scanState.currentPageStats = collection.listStats || null;
      store.scanState.queued = newLinks.length;
      store.saveScanState();

      if (newLinks.length === 0 && collection.currentJob) {
        await scanCurrentApplicationPage(context, store, listPage, collection.currentJob);
        store.updateScanState({
          running: false,
          phase: "Complete",
          queued: 0,
          currentJob: null,
          completedAt: new Date().toISOString()
        });
        break;
      }

      if (newLinks.length === 0 && hasAlreadyVisitedListPage) {
        store.updateScanState({
          running: false,
          phase: "Complete",
          queued: 0,
          currentJob: null,
          completedAt: new Date().toISOString()
        });
        break;
      }

      for (const link of newLinks) {
        if (!store.scanState.running) {
          break;
        }

        store.markLinkProcessed(link);
        store.scanState.queued = Math.max(0, store.scanState.queued - 1);
        await scanJobLink(context, store, link);
      }

      store.visitedListPages.add(collection.url);

      if (!store.scanState.running) {
        break;
      }

      if (!collection.hasNextPage) {
        store.updateScanState({
          running: false,
          phase: "Complete",
          queued: 0,
          currentJob: null,
          completedAt: new Date().toISOString()
        });
        break;
      }

      store.updateScanState({
        phase:
          newLinks.length === 0 ? `Skipping page ${store.scanState.pageCount} (already scanned)` : "Advancing to next page",
        queued: 0
      });

      const advanced = await browser.goToNextPageOnPage(listPage).then((response) => Boolean(response?.ok));

      if (!advanced) {
        store.updateScanState({
          running: false,
          phase: "Complete",
          lastError: "Reached the end of the job list.",
          completedAt: new Date().toISOString()
        });
        break;
      }

      await delay(PAGE_SETTLE_DELAY_MS * 2);
    }
  } catch (error) {
    const message = error?.message || "The scan stopped unexpectedly.";
    store.updateScanState({
      running: false,
      phase: "Stopped with error",
      lastError: message,
      completedAt: new Date().toISOString()
    });
    store.rememberError({
      type: "scan_loop_failed",
      errorType: "scan_loop_failed",
      site: store.scanState.site,
      siteLabel: store.scanState.siteLabel,
      status: "error",
      message
    });
    store.saveScanState();
  }
}

async function startScan(context, store, listUrl, userProfile) {
  if (store.scanState.running) {
    return { ok: false, error: "A scan is already running." };
  }

  const siteConfig = core.getSiteConfig(listUrl);

  if (!siteConfig) {
    return { ok: false, error: "Provide an Apple, TikTok, or ByteDance careers list page URL to scan." };
  }

  const normalizedProfile = core.normalizeUserProfile(userProfile);

  store.compactStoredJobRecords();
  store.resetProcessedTracking();
  store.hydrateProcessedFromStorage();

  const listPage = await browser.openPage(context, listUrl);

  store.scanState = {
    ...core.createIdleState(),
    running: true,
    phase: "Starting scan",
    listPageUrl: listUrl,
    site: siteConfig.id,
    siteLabel: siteConfig.label,
    pageCount: 1,
    userProfile: normalizedProfile,
    pid: process.pid
  };
  store.saveScanState();

  await runScanLoop(context, store, listPage);

  return { ok: true, status: store.scanState };
}

function stopScan(store) {
  store.updateScanState({ running: false, phase: "Stopped", currentJob: null, completedAt: new Date().toISOString() });
  return { ok: true, status: store.scanState };
}

module.exports = {
  runApplicationWorkflow,
  scanJobLink,
  scanCurrentApplicationPage,
  runScanLoop,
  startScan,
  stopScan
};

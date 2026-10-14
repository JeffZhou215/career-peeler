/* Same-document, single-use authority for a reviewed Apple withdrawal. */
(() => {
  if (globalThis.CareerPeelerAppleWithdrawalSafety) return;
  // Installed at document_start, before Apple registers event handlers. It is
  // inert during ordinary browsing; only a reviewed operation takes ownership.
  const events = ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "keydown"];
  const early = document.readyState === "loading";
  let activeInputGuard = null;
  if (early) for (const type of events) window.addEventListener(type, event => activeInputGuard?.(event), true);
  function create({ jobId, batchId, requestId, pageIndex, readRole, readPage, findConfirmation, getFailure }) {
    if (!early) throw new Error("Reload the Apple page to install safe withdrawal controls before reviewing this batch.");
    if (activeInputGuard) throw new Error("Another withdrawal owns this document.");
    if (!/^\d+(?:-\d+)?$/.test(jobId || "") || !batchId || !requestId || !Number.isInteger(pageIndex)) {
      throw new Error("A reviewed job, batch, request and page are required for withdrawal.");
    }
    const initial = readRole(jobId);
    if (!initial?.card || !initial.anchor || !initial.favoriteCheckbox || initial.jobId !== jobId || initial.favorite !== false ||
        initial.withdrawButton?.id !== `js-withdraw-link-${jobId}` || initial.anchor.id !== `role-title-${jobId}` ||
        initial.favoriteCheckbox.id !== `addToFavoriteId-favorite-${jobId}`) {
      throw new Error("The selected job identity and unstarred status could not be verified.");
    }
    const href = window.location.href;
    const expiresAt = Date.now() + 30000;
    let invalid = null;
    let modal = null;
    let proceedButton = null;
    let header = null;
    let modalContent = null;
    let visibleModal = false;
    let armed = null;
    let disposed = false;
    let successUpdated = false;
    const alertText = () => (document.querySelector("#global-alert")?.textContent || "").replace(/\s+/g, " ").trim();
    const previousAlertText = alertText();
    const prepared = new Set();
    const activated = new Set();
    const stop = reason => { invalid ||= reason; };
    const visible = element => {
      if (!element?.isConnected || element.hidden || element.closest?.('[hidden], [aria-hidden="true"]')) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    };
    const overlaysIn = node => node?.nodeType === 1
      ? [...(node.matches?.(".rc-overlay-popup-outer") ? [node] : []), ...node.querySelectorAll(".rc-overlay-popup-outer")] : [];
    if (document.querySelectorAll(".rc-overlay-popup-outer").length) {
      throw new Error("Resolve the existing popup before withdrawing this application.");
    }
    const contains = (node, child) => node === child || Boolean(node?.contains?.(child));
    function recordsChanged(records) {
      // Examine the mutation history, not only the final DOM. A→B→A in one
      // browser task must not regain the authority belonging to A.
      if (activated.has("proceed")) {
        successUpdated ||= records.some(record => ["childList", "characterData"].includes(record.type) &&
          (record.target?.id === "global-alert" || record.target?.parentElement?.closest?.("#global-alert") ||
           Array.from(record.addedNodes || []).some(node => node?.id === "global-alert" || node?.querySelector?.("#global-alert"))));
        return;
      }
      for (const record of records) {
        if (record.type === "childList") {
          if (modalContent !== null && contains(modal, record.target)) stop("The original withdrawal confirmation contents were rerendered.");
          for (const node of record.removedNodes) {
            if (contains(node, initial.card) || contains(node, initial.anchor) || contains(node, initial.withdrawButton) ||
                contains(node, initial.favoriteCheckbox) || (modal && contains(node, modal)) ||
                (proceedButton && contains(node, proceedButton)) || overlaysIn(node).length ||
                node?.id === "yourroles-withdrawmodal-proceed-button") stop("The withdrawal target or confirmation was removed or replaced.");
          }
          for (const node of record.addedNodes) for (const candidate of overlaysIn(node)) {
            if (!activated.has("open") || (modal && modal !== candidate)) stop("An unexpected or replacement confirmation appeared.");
            else {
              modal ||= candidate;
              // Bind a fully constructed first popup even while Proceed is
              // disabled. Enabling must not adopt content replaced meanwhile.
              const firstHeader = modal.querySelector("#yourroles-withdrawmodal-header");
              const firstProceed = modal.querySelector("#yourroles-withdrawmodal-proceed-button");
              if (firstHeader && firstProceed) {
                header ||= firstHeader;
                proceedButton ||= firstProceed;
                modalContent ??= modal.textContent;
              }
            }
          }
        } else if (record.type === "attributes") {
          if (["href", "id", "checked"].includes(record.attributeName) &&
              (contains(initial.card, record.target) || contains(modal, record.target))) stop("The withdrawal job identity changed.");
          if (modal && contains(modal, record.target) &&
              (["hidden", "aria-hidden"].includes(record.attributeName) ||
               visibleModal && ["style", "class"].includes(record.attributeName) && record.target === modal)) {
            stop("The original withdrawal confirmation changed visibility.");
          }
        } else if (record.type === "characterData" && modal && contains(modal, record.target)) {
          stop("The withdrawal confirmation changed unexpectedly.");
        }
      }
    }
    const observer = new MutationObserver(recordsChanged);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true,
      attributeOldValue: true, characterDataOldValue: true });
    function verify() {
      recordsChanged(observer.takeRecords());
      if (disposed || Date.now() > expiresAt) throw new Error("This withdrawal authority has expired. Review the batch again.");
      if (invalid) throw new Error(invalid);
      if (window.location.href !== href || readPage()?.pageIndex !== pageIndex) {
        stop("Apple changed the submissions page or navigation context.");
      }
      const role = readRole(jobId);
      if (!role || role.jobId !== jobId || role.favorite !== false || role.card !== initial.card ||
          role.anchor !== initial.anchor || role.favoriteCheckbox !== initial.favoriteCheckbox ||
          role.withdrawButton !== initial.withdrawButton || !initial.card.isConnected) {
        stop("The selected job identity, card or starred status could not be verified.");
      }
      const overlays = Array.from(document.querySelectorAll(".rc-overlay-popup-outer"));
      if (overlays.length && (!activated.has("open") || overlays.length !== 1 || overlays[0] !== modal)) {
        stop("The confirmation no longer belongs to the selected withdrawal.");
      }
      if (modal) {
        if (!modal.isConnected) stop("The original withdrawal confirmation is no longer present.");
        if (modalContent !== null && modal.textContent !== modalContent) stop("The original withdrawal confirmation contents changed.");
        const confirmation = findConfirmation();
        if (confirmation && confirmation.modal !== modal) stop("The withdrawal confirmation was replaced.");
        const currentHeader = modal.querySelector("#yourroles-withdrawmodal-header");
        if (header && (currentHeader !== header || (header.textContent || "").replace(/\s+/g, " ").trim() !==
            "Are you sure you want to withdraw this submission?")) stop("The original withdrawal confirmation heading changed.");
        header ||= currentHeader;
        const current = modal.querySelector("#yourroles-withdrawmodal-proceed-button");
        if (proceedButton && current !== proceedButton) stop("Apple replaced the original Proceed button.");
        proceedButton ||= current;
        if (header && proceedButton) modalContent ??= modal.textContent;
        if (visible(modal)) visibleModal = true;
      }
      if (invalid) throw new Error(invalid);
      return true;
    }
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    async function waitConfirmation() {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        verify();
        const confirmation = findConfirmation();
        if (modal && confirmation?.modal === modal && proceedButton && visible(proceedButton) &&
            !proceedButton.disabled && proceedButton.getAttribute("aria-disabled") !== "true") {
          modalContent ??= modal.textContent;
          return confirmation;
        }
        const failure = getFailure?.();
        if (failure) throw new Error(failure);
        await sleep(150);
      }
      throw new Error("Apple's original confirmation did not become ready. Review the page before retrying.");
    }
    async function prepare(stage) {
      if (!["open", "proceed"].includes(stage) || prepared.has(stage) || armed ||
          (stage === "proceed" && !activated.has("open"))) throw new Error("This withdrawal action was already used or is out of order.");
      prepared.add(stage); // Consume before the first await, including failed preflight.
      if (stage === "proceed") await waitConfirmation();
      const deadline = Date.now() + 5000;
      let signature = "";
      let stable = 0;
      let reason = "Apple's withdrawal button did not become ready.";
      while (Date.now() < deadline) {
        verify();
        const button = stage === "open" ? initial.withdrawButton : proceedButton;
        if (visible(button) && !button.disabled && button.getAttribute("aria-disabled") !== "true") {
          let rect = button.getBoundingClientRect();
          if (rect.top < 0 || rect.left < 0 || rect.bottom > window.innerHeight || rect.right > window.innerWidth) {
            button.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
            rect = button.getBoundingClientRect();
          }
          const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
          const hit = document.elementFromPoint(x, y);
          const next = [rect.left, rect.top, rect.width, rect.height, window.innerWidth, window.innerHeight].map(n => n.toFixed(1)).join("|");
          if (rect.width >= 2 && rect.height >= 2 && contains(button, hit)) {
            stable = next === signature ? stable + 1 : 1; signature = next;
            if (stable >= 3) {
              armed = { stage, button, x, y };
              return { x, y, jobId, batchId, requestId, identityVerified: true };
            }
            reason = "Apple's withdrawal button did not stop moving.";
          } else { stable = 0; reason = "Apple's withdrawal button is obscured or no longer visible."; }
        } else stable = 0;
        await sleep(150);
      }
      throw new Error(reason);
    }
    function onInput(event) {
      const withdrawalControl = event.target?.closest?.('button[id^="js-withdraw-link-"], #yourroles-withdrawmodal-proceed-button');
      if (activated.has("proceed")) {
        if (withdrawalControl) { event.preventDefault(); event.stopImmediatePropagation(); }
        return;
      }
      if (!armed || !contains(armed.button, event.target)) {
        stop("Another interaction interrupted the reviewed withdrawal.");
        if (withdrawalControl) { event.preventDefault(); event.stopImmediatePropagation(); }
        return;
      }
      try {
        verify();
        if (!event.isTrusted || !visible(armed.button) || armed.button.disabled || armed.button.getAttribute("aria-disabled") === "true") {
          throw new Error("The withdrawal action is unavailable or unexpected.");
        }
        // Recheck actual event coordinates too: Chrome's input is asynchronous.
        const hit = document.elementFromPoint(event.clientX, event.clientY);
        if (!contains(armed.button, hit)) throw new Error("The withdrawal click no longer targets the reviewed control.");
        if (event.type === "click") {
          activated.add(armed.stage);
          armed = null; // Single use before Apple's handlers run.
        }
      } catch (error) {
        stop(error.message); event.preventDefault(); event.stopImmediatePropagation();
      }
    }
    activeInputGuard = onInput;
    function finish(stage) {
      if (!activated.has(stage)) { verify(); throw new Error("Chrome did not activate the bound withdrawal control."); }
      if (stage === "open") verify();
      return { jobId, batchId, requestId, identityVerified: true, actionActivated: true };
    }
    return { prepare, finish, verify, waitConfirmation, get proceeded() { return activated.has("proceed"); },
      get successUpdated() { recordsChanged(observer.takeRecords()); return successUpdated && alertText() !== previousAlertText; },
      invalidate(reason = "The reviewed withdrawal was cancelled.") { stop(reason); },
      dispose() { disposed = true; observer.disconnect(); if (activeInputGuard === onInput) activeInputGuard = null; } };
  }
  globalThis.CareerPeelerAppleWithdrawalSafety = { create };
})();

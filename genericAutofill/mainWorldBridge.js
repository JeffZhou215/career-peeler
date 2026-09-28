// Workday's FormKit controller runs in the page's JavaScript world and can reject otherwise-correct
// native-setter/input events and clicks created in Chrome's isolated extension world. Keep this bridge
// limited to applying one already-resolved value or clicking one already-resolved Workday control;
// field discovery, profile access, policy, verification, and navigation remain in the isolated
// generic-autofill pipeline.
(function () {
  const BRIDGE_VERSION = 3;
  const BRIDGE_FLAG = "__careerPeelerMainWorldBridgeVersion";
  const TEXT_REQUEST_CHANNEL = "career-peeler-main-world-text-request-v3";
  const TEXT_RESPONSE_CHANNEL = "career-peeler-main-world-text-response-v3";
  const CLICK_REQUEST_CHANNEL = "career-peeler-main-world-click-request-v3";
  const CLICK_RESPONSE_CHANNEL = "career-peeler-main-world-click-response-v3";
  const TARGET_ATTRIBUTE = "data-career-peeler-main-world-target";

  if (window[BRIDGE_FLAG] === BRIDGE_VERSION) {
    return;
  }
  window[BRIDGE_FLAG] = BRIDGE_VERSION;

  // Workday can render a value in an input while its FormKit model still considers the answer
  // empty. A prototype setter plus a synthetic InputEvent does not fix that state on every tenant.
  // Reproduce the manual interaction that does: select the existing text, delete it through the
  // browser's editing pipeline, insert the prefix, and then type the final character. Chromium's
  // editing commands perform the mutation and emit the corresponding editing events; the caller
  // still verifies both the final DOM value and Workday's validation state after this bridge returns.
  function commitTextThroughBrowserEditing(element, value) {
    if (typeof document.execCommand !== "function") {
      return false;
    }

    const text = String(value ?? "");
    try {
      element.focus();
      element.select();
      document.execCommand("delete", false, null);
      if (element.value !== "") {
        return false;
      }

      if (text) {
        const prefix = text.slice(0, -1);
        if (prefix) {
          document.execCommand("insertText", false, prefix);
          if (element.value !== prefix) {
            return false;
          }
        }

        document.execCommand("insertText", false, text.slice(-1));
      }

      return element.value === text;
    } catch (_error) {
      return false;
    }
  }

  window.addEventListener("message", (event) => {
    const request = event.data;
    const responseChannel =
      request?.channel === TEXT_REQUEST_CHANNEL
        ? TEXT_RESPONSE_CHANNEL
        : request?.channel === CLICK_REQUEST_CHANNEL
          ? CLICK_RESPONSE_CHANNEL
          : "";
    if (event.source !== window || !responseChannel || !request.requestId || !request.targetId) {
      return;
    }

    let ok = false;
    let error = "";
    try {
      const selector = `[${TARGET_ATTRIBUTE}='${CSS.escape(String(request.targetId))}']`;
      const element = document.querySelector(selector);
      if (!element) throw new Error("The target control was unavailable in the page context.");

      if (request.channel === TEXT_REQUEST_CHANNEL) {
        if (!["INPUT", "TEXTAREA"].includes(element.tagName)) {
          throw new Error("The target text field was unavailable in the page context.");
        }

        const prototype = element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
        if (!nativeSetter) {
          throw new Error("The page-context value setter was unavailable.");
        }

        const wantedValue = String(request.value ?? "");
        const committedThroughBrowserEditing = commitTextThroughBrowserEditing(element, wantedValue);
        if (!committedThroughBrowserEditing) {
          element.focus();
          for (const stage of Array.isArray(request.stages) ? request.stages : []) {
            nativeSetter.call(element, String(stage.value ?? ""));
            element.dispatchEvent(
              new InputEvent("input", {
                inputType: stage.inputType || "insertText",
                data: stage.data ?? null,
                bubbles: true,
                composed: true
              })
            );
          }
        }
        element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        element.dispatchEvent(new Event("blur", { bubbles: true, composed: true }));
        element.blur();
      } else {
        element.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "auto" });
        if (request.sequence === "workday_prompt_menu_item") {
          element.dispatchEvent(new FocusEvent("focus", { composed: true }));
          const rect = element.getBoundingClientRect();
          const point = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
          element.dispatchEvent(
            new MouseEvent("mousedown", {
              bubbles: true,
              cancelable: true,
              composed: true,
              button: 0,
              buttons: 1,
              detail: 1,
              view: window,
              ...point
            })
          );
          element.dispatchEvent(
            new MouseEvent("mouseup", {
              bubbles: true,
              cancelable: true,
              composed: true,
              button: 0,
              buttons: 0,
              detail: 1,
              view: window,
              ...point
            })
          );
          element.dispatchEvent(
            new MouseEvent("click", {
              bubbles: true,
              cancelable: true,
              composed: true,
              button: 0,
              buttons: 0,
              detail: 1,
              view: window,
              ...point
            })
          );
          element.dispatchEvent(new FocusEvent("blur", { composed: true }));
          ok = true;
          window.postMessage(
            { channel: responseChannel, requestId: request.requestId, ok, error },
            "*"
          );
          return;
        }

        // Workday responsive prompt results disappear as soon as their search input blurs. For an
        // option click, preserve that input focus until pointerdown/click reaches Workday's handler;
        // focusing the option first minimizes and detaches the prompt before selection can commit.
        if (request.focus !== false) {
          element.focus?.({ preventScroll: true });
        }
        const rect = element.getBoundingClientRect();
        const point = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };

        if (typeof PointerEvent === "function") {
          element.dispatchEvent(
            new PointerEvent("pointerdown", { bubbles: true, cancelable: true, composed: true, button: 0, ...point })
          );
        }
        element.dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, cancelable: true, composed: true, button: 0, ...point })
        );
        if (typeof PointerEvent === "function") {
          element.dispatchEvent(
            new PointerEvent("pointerup", { bubbles: true, cancelable: true, composed: true, button: 0, ...point })
          );
        }
        element.dispatchEvent(
          new MouseEvent("mouseup", { bubbles: true, cancelable: true, composed: true, button: 0, ...point })
        );
        element.click();
      }
      ok = true;
    } catch (caught) {
      error = caught?.message || "The page-context action failed.";
    }

    window.postMessage(
      {
        channel: responseChannel,
        requestId: request.requestId,
        ok,
        error
      },
      "*"
    );
  });
})();

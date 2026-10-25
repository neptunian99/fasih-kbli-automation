function allowedLocalUrl(value) {
  const url = new URL(value);
  return url.protocol === "http:"
    && ["127.0.0.1", "localhost"].includes(url.hostname);
}

async function replaceFocusedInputWithTrustedText(tabId, value) {
  const target = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, "1.3");
    attached = true;

    const platform = await chrome.runtime.getPlatformInfo();
    const selectAllModifier = platform.os === "mac" ? 4 : 2;
    const selectionEvent = {
      modifiers: selectAllModifier,
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
      nativeVirtualKeyCode: 65,
    };
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
      ...selectionEvent,
      type: "rawKeyDown",
    });
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
      ...selectionEvent,
      type: "keyUp",
    });
    await chrome.debugger.sendCommand(target, "Input.insertText", {
      text: String(value),
    });

    // Tab merupakan blur yang benar-benar berasal dari browser. FASIH
    // melakukan commit state formulir pada input/blur tepercaya, bukan hanya
    // pada perubahan atribut value di DOM.
    const tabEvent = {
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
    };
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
      ...tabEvent,
      type: "rawKeyDown",
    });
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
      ...tabEvent,
      type: "keyUp",
    });
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.action === "trustedReplaceInput") {
    (async () => {
      try {
        const tabId = sender.tab?.id;
        if (!tabId) throw new Error("Tab FASIH tidak ditemukan untuk pengisian tepercaya.");
        const value = String(message.value ?? "");
        if (!/^-?\d+$/.test(value)) {
          throw new Error("Nilai input FASIH harus berupa angka.");
        }
        await replaceFocusedInputWithTrustedText(tabId, value);
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, message: error.message });
      }
    })();
    return true;
  }

  if (message?.action === "closeCompletedTab") {
    const tabId = sender.tab?.id;
    sendResponse({ ok: Boolean(tabId) });
    if (tabId) setTimeout(() => chrome.tabs.remove(tabId).catch(() => {}), 100);
    return false;
  }

  if (message?.action === "restoreAssistantTab") {
    (async () => {
      try {
        const callback = new URL(message.callbackUrl);
        if (!allowedLocalUrl(callback.href)) {
          throw new Error("Alamat halaman pendamping tidak diizinkan.");
        }

        let assistantTab;
        if (sender.tab?.openerTabId) {
          const opener = await chrome.tabs.get(sender.tab.openerTabId).catch(() => undefined);
          if (opener?.url && allowedLocalUrl(opener.url)
            && new URL(opener.url).origin === callback.origin) {
            assistantTab = opener;
          }
        }

        if (!assistantTab) {
          const localTabs = await chrome.tabs.query({
            windowId: sender.tab?.windowId,
            url: ["http://127.0.0.1/*", "http://localhost/*"],
          });
          assistantTab = localTabs
            .filter((tab) => tab.url && new URL(tab.url).origin === callback.origin)
            .sort((left, right) => (right.lastAccessed ?? 0) - (left.lastAccessed ?? 0))[0];
        }

        if (!assistantTab?.id) throw new Error("Tab pendamping tidak ditemukan.");
        await chrome.tabs.update(assistantTab.id, { active: true });
        if (assistantTab.windowId) {
          await chrome.windows.update(assistantTab.windowId, { focused: true });
        }
        sendResponse({ ok: true, tabId: assistantTab.id });
      } catch (error) {
        sendResponse({ ok: false, message: error.message });
      }
    })();
    return true;
  }

  if (message?.action === "reportAutomationResult") {
    (async () => {
      try {
        const callback = new URL(message.job?.callbackUrl);
        if (!allowedLocalUrl(callback.href)) {
          throw new Error("Alamat callback lokal tidak diizinkan.");
        }
        const response = await fetch(callback.href, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: message.job.token,
            requestId: message.job.requestId,
            rowNumber: message.job.rowNumber,
            status: message.job.status,
            values: message.job.values,
            ok: message.ok === true,
            message: String(message.message ?? ""),
            outcome: message.outcome === "manual-review" ? "manual-review" : undefined,
            errorCount: Number.isInteger(message.errorCount) ? message.errorCount : undefined,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
        sendResponse({ ok: true, closeTab: result.closeTab === true });
      } catch (error) {
        sendResponse({ ok: false, message: error.message });
      }
    })();
    return true;
  }

  if (message?.action === "checkAutomationPermit") {
    (async () => {
      try {
        const callback = new URL(message.job?.callbackUrl);
        if (!allowedLocalUrl(callback.href)) {
          throw new Error("Alamat callback lokal tidak diizinkan.");
        }
        const permitUrl = new URL("/api/automation-permit", callback.origin);
        permitUrl.searchParams.set("token", String(message.job?.token ?? ""));
        permitUrl.searchParams.set("requestId", String(message.job?.requestId ?? ""));
        const response = await fetch(permitUrl.href, { cache: "no-store" });
        const result = await response.json().catch(() => ({}));
        if (response.status === 202) {
          sendResponse({
            ok: true,
            permitted: false,
            position: Number(result.position ?? 0),
          });
          return;
        }
        if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
        sendResponse({ ok: true, permitted: result.permitted === true, position: 1 });
      } catch (error) {
        sendResponse({ ok: false, permitted: false, message: error.message });
      }
    })();
    return true;
  }

  return false;
});

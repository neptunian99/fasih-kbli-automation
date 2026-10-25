(() => {
  const prefix = "#fasih-kbli-auto=";
  const pendingUrlJobKey = "fasih-kbli-assistant:url-job";
  const waitingUrlJobKey = "fasih-kbli-assistant:waiting-url-job";

  const decodeJob = (encodedValue) => {
    const encoded = encodedValue.replace(/-/g, "+").replace(/_/g, "/");
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  };

  const validJob = (job) => {
    const callback = new URL(job.callbackUrl);
    return Boolean(job.requestId && job.payload && callback.protocol === "http:"
      && ["127.0.0.1", "localhost"].includes(callback.hostname));
  };

  const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  let job;

  try {
    if (location.hash.startsWith(prefix)) {
      job = decodeJob(location.hash.slice(prefix.length));
      if (!validJob(job)) throw new Error("Paket URL tidak valid.");
      sessionStorage.setItem(waitingUrlJobKey, JSON.stringify(job));
      history.replaceState(history.state, "", `${location.pathname}${location.search}`);
    } else {
      job = JSON.parse(sessionStorage.getItem(waitingUrlJobKey) ?? "null");
    }
    if (!job || !validJob(job)) return;
    const callback = new URL(job.callbackUrl);
    chrome.runtime.sendMessage({
      action: "restoreAssistantTab",
      callbackUrl: callback.href,
    }).catch((error) => {
      console.warn("Pendamping DOM FASIH gagal mengaktifkan kembali tab pendamping:", error);
    });

    (async () => {
      const deadline = Date.now() + 30 * 60 * 1000;
      let lastMessage = "Proses otomatis belum terdaftar.";
      while (Date.now() < deadline) {
        const permit = await chrome.runtime.sendMessage({
          action: "checkAutomationPermit",
          job,
        }).catch((error) => ({ ok: false, message: error.message }));
        if (permit?.ok && permit.permitted === true) {
          sessionStorage.removeItem(waitingUrlJobKey);
          sessionStorage.setItem(pendingUrlJobKey, JSON.stringify(job));
          location.reload();
          return;
        }
        lastMessage = permit?.message || (permit?.position > 1
          ? `Menunggu antrean assignment posisi ${permit.position}.`
          : lastMessage);
        await delay(1000);
      }
      console.error("Pendamping DOM FASIH gagal memperoleh izin antrean:", lastMessage);
    })();
  } catch (error) {
    sessionStorage.removeItem(waitingUrlJobKey);
    console.error("Pendamping DOM FASIH gagal membaca paket URL:", error);
  }
})();

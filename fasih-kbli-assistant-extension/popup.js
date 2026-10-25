const payloadBox = document.querySelector("#payload");
const statusBox = document.querySelector("#status");
const expectedContentVersion = "0.1.16-kbli";

function show(message) {
  statusBox.textContent = message;
}

async function activeFasihTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !String(tab.url ?? "").startsWith("https://fasih-sm.bps.go.id/app/")) {
    throw new Error("Aktifkan tab FASIH terlebih dahulu.");
  }
  return tab;
}

async function send(action, payload) {
  const tab = await activeFasihTab();
  let probe;
  try {
    probe = await chrome.tabs.sendMessage(tab.id, { action: "probe" });
  } catch (error) {
    const message = String(error?.message ?? error);
    if (message.includes("message port closed") || message.includes("port closed")) {
      throw new Error("Tab FASIH masih menjalankan skrip lama. Refresh tab FASIH sekali, lalu coba lagi.");
    }
    if (!message.includes("Receiving end does not exist")
      && !message.includes("Could not establish connection")) {
      throw error;
    }

    show("Menghubungkan pendamping ke tab FASIH…");
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
    probe = await chrome.tabs.sendMessage(tab.id, { action: "probe" });
  }

  if (probe?.version !== expectedContentVersion) {
    throw new Error(`Tab FASIH memakai skrip lama (${probe?.version ?? "tidak diketahui"}). Refresh tab FASIH sekali, lalu coba lagi.`);
  }
  return chrome.tabs.sendMessage(tab.id, { action, payload });
}

document.querySelector("#scan").addEventListener("click", async () => {
  try {
    show("Memeriksa DOM…");
    const result = await send("scan");
    show(result?.message ?? "Tidak ada hasil.");
  } catch (error) {
    show(`Gagal: ${error.message}`);
  }
});

document.querySelector("#fillRemark").addEventListener("click", async () => {
  try {
    const payload = JSON.parse(payloadBox.value);
    if (payload.kind !== "kbli" || !payload.businessName || !/^\d{5}$/.test(String(payload.targetCode))) throw new Error("Paket KBLI tidak lengkap.");
    show("Membuka usaha, memilih KBLI 13.g, menambahkan remark, memeriksa galat, lalu mengirim…");
    const result = await send("fillRemark", payload);
    show(result?.message ?? "Selesai.");
  } catch (error) {
    show(`Gagal: ${error.message}`);
  }
});

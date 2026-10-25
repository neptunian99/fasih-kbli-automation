(() => {
  const contentVersion = "0.1.16-kbli";
  if (globalThis.__fasihKbliAssistantVersion === contentVersion) return;
  globalThis.__fasihKbliAssistantVersion = contentVersion;
  const pendingKey = "fasih-kbli-assistant:pending";
  const pendingReviewKey = "fasih-kbli-assistant:pending-review";
  const pendingApprovalKey = "fasih-kbli-assistant:pending-approval";
  const activeAutoJobKey = "fasih-kbli-assistant:auto-job";
  const pendingUrlJobKey = "fasih-kbli-assistant:url-job";
  const stalledAutomationMs = 150000;
  const maxAutomaticRestarts = 2;
  const maxPersistenceRestarts = 2;
  let lastAutomationProgressAt = Date.now();
  let recoveryInProgress = false;
  class MultipleErrorsFound extends Error {
    constructor(errorCount) {
      super(`Masih ada ${errorCount} galat. Kirim final dibatalkan agar data dapat diperiksa.`);
      this.name = "MultipleErrorsFound";
      this.code = "MULTIPLE_ERRORS";
      this.errorCount = errorCount;
    }
  }
  class PersistedValuesMismatch extends Error {
    constructor(message, mismatches) {
      super(message);
      this.name = "PersistedValuesMismatch";
      this.code = "PERSISTED_VALUES_MISMATCH";
      this.mismatches = mismatches;
    }
  }
  const fieldMap = {
    q26a: ["26. A.", "30. A."],
    q26b: ["26. B.", "30. B."],
    q26c: ["26. C.", "30. C."],
    q26d: ["26. D.", "30. D."],
    q26e: ["26. E.", "30. E."],
    q27a: ["27. A.", "31. A."],
    q27b: ["27. B.", "31. B."],
  };
  const optionalFieldKeys = new Set(["q26c"]);

  const normalize = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toUpperCase();
  const visible = (element) => {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const leafText = (element) => normalize([...element.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent)
    .join(" "));

  function accessibleName(element) {
    const describedBy = String(element.getAttribute?.("aria-describedby") ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    return normalize([
      element.textContent,
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("title"),
      element.getAttribute?.("data-tooltip"),
      element.getAttribute?.("data-tooltip-content"),
      element.getAttribute?.("data-tip"),
      describedBy,
    ].filter(Boolean).join(" "));
  }

  function textCandidates() {
    return [...document.querySelectorAll("body *")].filter((element) => visible(element) && leafText(element));
  }

  function deepElements(root = document) {
    const result = [];
    const visit = (currentRoot) => {
      for (const element of currentRoot.querySelectorAll("*")) {
        result.push(element);
        if (element.shadowRoot) visit(element.shadowRoot);
      }
    };
    visit(root);
    return result;
  }

  function smallestTextElement(predicate) {
    return textCandidates()
      .filter((element) => predicate(leafText(element)))
      .sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height)[0] ?? null;
  }

  function clickable(element) {
    if (!element) return null;
    return element.closest("button,a,[role='button']") ?? element;
  }

  function clickExact(text) {
    const target = smallestTextElement((value) => value === normalize(text));
    if (!target) return false;
    clickable(target).click();
    return true;
  }

  function showPageNotice(message, kind = "info") {
    lastAutomationProgressAt = Date.now();
    let notice = document.querySelector("#fasih-dom-assistant-notice");
    if (!notice) {
      notice = document.createElement("div");
      notice.id = "fasih-dom-assistant-notice";
      Object.assign(notice.style, {
        position: "fixed",
        zIndex: "2147483647",
        top: "18px",
        left: "50%",
        transform: "translateX(-50%)",
        maxWidth: "680px",
        padding: "12px 16px",
        borderRadius: "10px",
        boxShadow: "0 8px 30px rgba(0,0,0,.22)",
        color: "white",
        font: "600 14px system-ui,sans-serif",
        whiteSpace: "pre-wrap",
      });
      document.documentElement.append(notice);
    }
    notice.style.background = kind === "error" ? "#b42318" : kind === "success" ? "#18794e" : "#1d4ed8";
    notice.textContent = message;
  }

  function savePending(action, payload) {
    sessionStorage.setItem(pendingKey, JSON.stringify({ action, payload, savedAt: Date.now() }));
  }

  function clearPending() {
    sessionStorage.removeItem(pendingKey);
  }

  function activeAutoJob() {
    try {
      return JSON.parse(sessionStorage.getItem(activeAutoJobKey) ?? "null");
    } catch {
      return null;
    }
  }

  function activeAutoJobId() {
    return activeAutoJob()?.requestId || null;
  }

  function assignmentUrlWithoutEdit() {
    const url = new URL(location.href);
    url.pathname = url.pathname.replace(/\/edit\/?$/i, "").replace(/\/$/, "");
    url.hash = "";
    return url.href;
  }

  async function restartStalledAutomation() {
    if (recoveryInProgress || !isEditRoute() || Date.now() - lastAutomationProgressAt < stalledAutomationMs) return;
    const job = activeAutoJob();
    if (!job?.requestId || assignmentPath(job.payload?.fasihLink) !== assignmentPath(location.href)) return;

    const restartCount = Number(job.automaticRestartCount ?? 0);
    if (restartCount >= maxAutomaticRestarts) {
      recoveryInProgress = true;
      const message = `Proses tidak bergerak setelah ${restartCount} kali pemulihan otomatis. Tab dibiarkan terbuka untuk pemeriksaan manual.`;
      showPageNotice(message, "error");
      await reportAutomationResult(job.requestId, false, message).catch(() => {});
      return;
    }

    recoveryInProgress = true;
    const restartedJob = {
      ...job,
      automaticRestartCount: restartCount + 1,
      createdAt: Date.now(),
    };
    sessionStorage.setItem(pendingUrlJobKey, JSON.stringify(restartedJob));
    sessionStorage.setItem(activeAutoJobKey, JSON.stringify(restartedJob));
    sessionStorage.removeItem(pendingKey);
    sessionStorage.removeItem(pendingReviewKey);
    sessionStorage.removeItem(pendingApprovalKey);
    showPageNotice(`Proses terdeteksi berhenti. Memuat ulang assignment tanpa /edit dan mengulang dari awal (${restartCount + 1}/${maxAutomaticRestarts})…`);
    location.replace(assignmentUrlWithoutEdit());
  }

  function automationFailureDetails(error) {
    if (error?.code !== "MULTIPLE_ERRORS" || !Number.isInteger(error.errorCount) || error.errorCount <= 1) return {};
    return { outcome: "manual-review", errorCount: error.errorCount };
  }

  async function reportAutomationResult(jobId, ok, message, details = {}) {
    if (!jobId) return;
    const job = activeAutoJob();
    if (!job || job.requestId !== jobId) return;
    const response = await chrome.runtime.sendMessage({
      action: "reportAutomationResult",
      job: {
        requestId: job.requestId,
        rowNumber: job.rowNumber,
        callbackUrl: job.callbackUrl,
        token: job.token,
        status: job.payload?.suggestedStatus,
        values: job.payload?.values,
      },
      ok: ok === true,
      message: String(message ?? ""),
      outcome: details.outcome === "manual-review" ? "manual-review" : undefined,
      errorCount: Number.isInteger(details.errorCount) ? details.errorCount : undefined,
    });
    if (!response?.ok) throw new Error(`Hasil FASIH tidak dapat dikirim ke pendamping: ${response?.message || "tanpa respons"}`);
    sessionStorage.removeItem(activeAutoJobKey);
    if (response.closeTab === true) {
      chrome.runtime.sendMessage({ action: "closeCompletedTab" }).catch(() => {});
    }
  }

  function isEditRoute() {
    return /\/edit\/?$/i.test(location.pathname);
  }

  function isEditMode() {
    // Route /edit sudah cukup untuk menandakan mode edit. Saat halaman masih
    // memuat, indikator MODE EDIT dan tombol Kirim dapat muncul terlambat.
    // Tanpa pemeriksaan route ini, tombol panah kembali di kanan bawah dapat
    // keliru dianggap sebagai tombol edit/revoke.
    if (isEditRoute()) return true;
    const hasIndicator = textCandidates().some((element) => leafText(element).includes("MODE EDIT"));
    const hasSubmit = [...document.querySelectorAll("button,[role='button']")]
      .some((button) => visible(button) && normalize(button.textContent) === "KIRIM");
    return hasIndicator || hasSubmit;
  }

  function findEditButton() {
    // Jangan pernah memakai fallback posisi pada route edit. Tombol paling
    // bawah di kanan pada route ini adalah tombol kembali, bukan edit/revoke.
    if (isEditRoute()) return null;
    const buttons = [...document.querySelectorAll("button,[role='button']")].filter(visible);
    const semantic = buttons.find((button) => {
      const description = normalize([
        button.textContent,
        button.getAttribute("aria-label"),
        button.getAttribute("title"),
        button.getAttribute("data-testid"),
      ].filter(Boolean).join(" "));
      return /(^| )(EDIT|UBAH|MODE EDIT)( |$)/.test(description) && !description.includes("CLOSE");
    });
    if (semantic) return semantic;

    // Pastikan halaman review utuh sudah tampil sebelum memakai posisi panel.
    // Saat render awal, hanya tombol kembali yang kadang muncul lebih dahulu.
    const reviewReady = buttons.some((button) => normalize(button.textContent) === "RINGKASAN");
    if (!reviewReady) return null;

    // Fallback khusus panel aksi FASIH: aksi edit atau revoke adalah tombol
    // kecil paling bawah pada sisi kanan. Jenis aksinya dipastikan dari hasil
    // klik: mode edit langsung atau dialog Revoke Assignment.
    const railButtons = buttons
      .filter((button) => {
        const rect = button.getBoundingClientRect();
        return rect.right > window.innerWidth - 170
          && rect.bottom > window.innerHeight - 260
          && rect.width > 28 && rect.width < 100
          && rect.height > 28 && rect.height < 100;
      });
    // Minimal dua aksi bawah harus sudah muncul. Pada assignment yang belum
    // dikirim pasangan terbawah adalah centang + pensil; pada assignment yang
    // sudah approve pasangan terbawah mencakup info + revoke. Route /edit
    // sudah dikecualikan di atas sehingga panah kembali tidak akan dipilih.
    if (railButtons.length < 2) return null;
    return railButtons
      .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0] ?? null;
  }

  function revokeDialog() {
    const dialogs = [...document.querySelectorAll("[role='dialog']")].filter(visible);
    const roleDialog = dialogs.find((element) => normalize(element.textContent).includes("REVOKE ASSIGNMENT"));
    if (roleDialog) return roleDialog;

    const marker = smallestTextElement((value) => value.includes("REVOKE ASSIGNMENT"));
    let current = marker;
    for (let depth = 0; depth < 10 && current; depth += 1, current = current.parentElement) {
      const buttons = [...current.querySelectorAll("button,[role='button']")].filter(visible);
      if (buttons.some((button) => ["REVOKE", "KONFIRMASI"].includes(normalize(button.textContent)))) return current;
    }
    return null;
  }

  function revokeConfirmButton(dialog) {
    const buttons = [...dialog.querySelectorAll("button,[role='button']")].filter(visible);
    return buttons.find((button) => normalize(button.textContent) === "REVOKE")
      ?? buttons.find((button) => normalize(button.textContent) === "KONFIRMASI")
      ?? null;
  }

  async function openEditModeOrRevoke(action, payload) {
    if (isEditMode()) return;
    savePending(action, payload);

    for (let attempt = 0; attempt < 3 && !isEditMode(); attempt += 1) {
      showPageNotice(attempt === 0
        ? "Menunggu halaman assignment dan aksi edit siap…"
        : "Revoke selesai. Menunggu tombol pensil siap…");
      const nextAction = await waitFor(() => {
        if (isEditMode()) return { type: "edit" };
        const button = findEditButton();
        return button ? { type: "button", button } : null;
      }, "Tombol pensil atau revoke", 120000);
      if (nextAction.type === "edit") return;
      showPageNotice("Membuka mode edit… jika assignment telah di-approve, revoke akan dikonfirmasi terlebih dahulu.");
      // Status dapat berubah ketika FASIH selesai merender. Periksa lagi tepat
      // sebelum klik agar tombol panah kembali tidak tersentuh pada halaman edit.
      if (isEditMode()) return;
      nextAction.button.click();

      const outcome = await waitFor(() => {
        if (isEditMode()) return { type: "edit" };
        const dialog = revokeDialog();
        return dialog ? { type: "revoke", dialog } : null;
      }, "Mode edit atau dialog Revoke Assignment", 30000);
      if (outcome.type === "edit") return;

      const confirmButton = revokeConfirmButton(outcome.dialog);
      if (!confirmButton) throw new Error("Tombol Revoke/Konfirmasi pada dialog Revoke Assignment tidak ditemukan.");
      showPageNotice("Assignment telah di-approve. Mengonfirmasi revoke sebelum membuka mode edit…");
      confirmButton.click();
      await waitFor(() => !visible(outcome.dialog), "Penyelesaian revoke", 60000);
      await new Promise((resolve) => setTimeout(resolve, 800));
    }

    if (!isEditMode()) throw new Error("Mode edit belum aktif setelah assignment di-revoke.");
  }

  async function ensureEditMode(action, payload) {
    if (isEditMode()) return;
    await openEditModeOrRevoke(action, payload);
    clearPending();
  }

  function waitFor(check, description, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      let observer;
      let interval;
      let timer;
      let finished = false;

      const cleanup = () => {
        observer?.disconnect();
        if (interval) clearInterval(interval);
        if (timer) clearTimeout(timer);
      };

      const verify = () => {
        if (finished) return;
        try {
          const result = check();
          if (!result) return;
          finished = true;
          cleanup();
          resolve(result);
        } catch {
          // DOM FASIH dapat berubah di tengah render; periksa lagi pada mutasi berikutnya.
        }
      };

      observer = new MutationObserver(verify);
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      interval = setInterval(verify, 500);

      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        timer = setTimeout(() => {
          finished = true;
          cleanup();
          reject(new Error(`${description} tidak ditemukan dalam ${Math.round(timeoutMs / 1000)} detik.`));
        }, timeoutMs);
      }

      verify();
    });
  }

  function questionLabel(prefixes) {
    const normalizedPrefixes = (Array.isArray(prefixes) ? prefixes : [prefixes]).map(normalize);
    return smallestTextElement((value) => normalizedPrefixes.some((prefix) => value.startsWith(prefix)));
  }

  function editableInputs() {
    return [...document.querySelectorAll("input:not([disabled]):not([type='hidden']),textarea:not([disabled])")].filter(visible);
  }

  function readableInputs() {
    return [...document.querySelectorAll("input:not([type='hidden']),textarea")].filter(visible);
  }

  function nearestInputFrom(label, inputs) {
    const labelRect = label.getBoundingClientRect();
    const candidates = inputs.map((input) => {
      const rect = input.getBoundingClientRect();
      const vertical = Math.abs((rect.top + rect.bottom) / 2 - (labelRect.top + labelRect.bottom) / 2);
      const leftPenalty = rect.right < labelRect.left ? 1000 : 0;
      return { input, score: vertical + leftPenalty };
    }).sort((a, b) => a.score - b.score);
    return candidates[0]?.score < 140 ? candidates[0].input : null;
  }

  function nearestInput(label) {
    return nearestInputFrom(label, editableInputs());
  }

  function nearestReadableInput(label) {
    return nearestInputFrom(label, readableInputs());
  }

  function digits(value, divisor = 1) {
    const cleaned = String(value ?? "").replace(/[^0-9-]/g, "");
    const parsed = cleaned === "" || cleaned === "-" ? 0 : Number.parseInt(cleaned, 10);
    return String(divisor === 1 ? parsed : Math.round(parsed / divisor));
  }

  function isMonthlyBranch(item) {
    const label = item?.label ? leafText(item.label) : "";
    return label.startsWith("30.") || label.startsWith("31.");
  }

  function setFrameworkValue(input, value, strategy = "native") {
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (!setter) throw new Error("Setter input tidak tersedia.");
    input.focus();
    const previousValue = input.value;
    if (strategy === "interactive") {
      try {
        input.select();
      } catch {
        // Sebagian input numerik tidak menyediakan select().
      }
    }
    // Selalu gunakan setter native dan kirim event input. execCommand dapat
    // mengubah teks yang terlihat tanpa memperbarui state React/Vue FASIH;
    // akibatnya DOM tampak benar tetapi payload Kirim masih memakai nilai lama.
    setter.call(input, String(value));
    if (input._valueTracker?.setValue) input._valueTracker.setValue(previousValue);
    input.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      composed: true,
      inputType: "insertReplacementText",
      data: String(value),
    }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.blur();
  }

  async function setTrustedFieldValue(input, value) {
    input.focus({ preventScroll: true });
    try {
      input.select();
    } catch {
      try {
        input.setSelectionRange(0, String(input.value ?? "").length);
      } catch {
        // Background juga mengirim shortcut Select All tepercaya.
      }
    }
    const response = await chrome.runtime.sendMessage({
      action: "trustedReplaceInput",
      value: String(value),
    });
    if (!response?.ok) {
      throw new Error(
        response?.message
          ? `Input tepercaya gagal: ${response.message}`
          : "Input tepercaya tidak mendapat respons dari ekstensi.",
      );
    }
  }

  const settle = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function locateFields() {
    const result = {};
    for (const [key, prefix] of Object.entries(fieldMap)) {
      const label = questionLabel(prefix);
      const input = label ? nearestInput(label) : null;
      result[key] = { label, input };
    }
    return result;
  }

  function locateReadableFields() {
    const result = {};
    for (const [key, prefix] of Object.entries(fieldMap)) {
      const label = questionLabel(prefix);
      const input = label ? nearestReadableInput(label) : null;
      result[key] = { label, input };
    }
    return result;
  }

  function kbliQuestionLabel() {
    return questionLabel(["13. G.", "13.G."])
      ?? smallestTextElement((value) => value.includes("13. G") && value.includes("KODE KBLI"));
  }

  function kbliQuestionContainer() {
    const label = kbliQuestionLabel();
    if (!label) return null;
    const candidates = [];
    let current = label.parentElement;
    for (let depth = 0; depth < 10 && current; depth += 1, current = current.parentElement) {
      const text = normalize(current.textContent);
      const radios = current.querySelectorAll("input[type='radio']").length;
      if (text.includes("KODE KBLI") && (radios > 0 || text.includes("DAPATKAN REKOMENDASI KBLI"))) {
        const rect = current.getBoundingClientRect();
        candidates.push({ element: current, score: rect.width * rect.height });
      }
    }
    return candidates.sort((a, b) => a.score - b.score)[0]?.element ?? label.parentElement;
  }

  function radioText(input) {
    const id = input.id;
    const explicit = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
    const wrapped = input.closest("label");
    const direct = normalize(explicit?.textContent || wrapped?.textContent);
    if (direct && direct.length < 500) return direct;

    // Beberapa radio FASIH tidak mempunyai label/for dan parent-nya memuat
    // seluruh daftar rekomendasi. Cari teks pada baris radio yang sama agar
    // kode dari radio tetangga tidak ikut dianggap sebagai nilai aktif.
    const rect = input.getBoundingClientRect();
    const centerY = (rect.top + rect.bottom) / 2;
    const nearby = textCandidates()
      .filter((element) => !element.contains(input) && !input.contains(element))
      .map((element) => {
        const itemRect = element.getBoundingClientRect();
        const itemY = (itemRect.top + itemRect.bottom) / 2;
        return {
          element,
          text: leafText(element),
          score: Math.abs(itemY - centerY) * 10 + Math.abs(itemRect.left - rect.right),
          rect: itemRect,
        };
      })
      .filter((item) => item.text
        && Math.abs((item.rect.top + item.rect.bottom) / 2 - centerY) < 34
        && item.rect.right > rect.left - 20)
      .sort((a, b) => a.score - b.score);
    return nearby[0]?.text ?? normalize(input.parentElement?.textContent);
  }

  function kbliRadioChoices() {
    const container = kbliQuestionContainer();
    if (!container) return [];
    return [...container.querySelectorAll("input[type='radio']")].map((input) => ({ input, text: radioText(input) }));
  }

  function isMasterKbliChoice(choice) {
    if (!choice?.input) return false;
    if (choice.text === "PILIH DARI MASTER KBLI") return true;
    const rect = choice.input.getBoundingClientRect();
    const centerY = (rect.top + rect.bottom) / 2;
    return masterKbliLabels().some((label) => {
      const labelRect = label.getBoundingClientRect();
      const labelY = (labelRect.top + labelRect.bottom) / 2;
      return Math.abs(labelY - centerY) < 34
        && labelRect.left >= rect.left - 30;
    });
  }

  function clickRadio(choice) {
    const id = choice.input.id;
    const explicit = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
    (explicit ?? choice.input.closest("label") ?? choice.input).click();
  }

  function masterKbliInput(control) {
    if (!control) return null;
    const direct = control.matches?.("input:not([disabled]),textarea:not([disabled])") ? control : null;
    if (direct) return direct;

    const descendant = control.querySelector?.(
      "input[role='combobox']:not([disabled]),input[aria-autocomplete]:not([disabled]),input:not([type='hidden']):not([disabled]),textarea:not([disabled])",
    );
    if (descendant) return descendant;

    const controlRect = control.getBoundingClientRect();
    return [...document.querySelectorAll(
      "input:not([type='hidden']):not([disabled]),textarea:not([disabled])",
    )]
      .map((input) => {
        const rect = input.getBoundingClientRect();
        const inside = control.contains(input) || input.contains(control);
        const ancestor = input.closest("[role='combobox'],.ant-select,[class*='select']");
        const sharesContainer = Boolean(ancestor && (ancestor.contains(control) || control.contains(ancestor)));
        if (!inside && !sharesContainer) return { input, score: Number.POSITIVE_INFINITY };
        const distance = Math.hypot(
          rect.left + rect.width / 2 - (controlRect.left + controlRect.width / 2),
          rect.top + rect.height / 2 - (controlRect.top + controlRect.height / 2),
        );
        return { input, score: inside ? -2000 : sharesContainer ? -1000 : distance };
      })
      .filter((candidate) => Number.isFinite(candidate.score))
      .sort((a, b) => a.score - b.score)[0]?.input ?? null;
  }

  function masterKbliLabels() {
    return [...document.querySelectorAll("body *")]
      .filter(visible)
      .filter((element) => {
        const value = normalize(element.textContent).replace(/[\s:*]+$/g, "");
        return value === "PILIH DARI MASTER KBLI";
      })
      .sort((a, b) => {
        const area = (element) => element.getBoundingClientRect().width * element.getBoundingClientRect().height;
        return area(a) - area(b);
      });
  }

  function masterKbliValueMatch(labels, targetCode = "") {
    const targetPattern = /^\d{5}$/.test(String(targetCode))
      ? new RegExp(`(^|\\D)${targetCode}(\\D|$)`)
      : /(^|\D)\d{5}(\D|$)/;
    const values = [...document.querySelectorAll("body *")].filter((element) => {
      if (!visible(element)) return false;
      const text = normalize([
        element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : "",
        element.textContent,
      ].filter(Boolean).join(" "));
      if (!targetPattern.test(text) || text.length > 240) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 20 && rect.height > 10 && rect.height < 110;
    });
    const matches = [];
    for (const label of labels) {
      const labelRect = label.getBoundingClientRect();
      const labelY = (labelRect.top + labelRect.bottom) / 2;
      for (const value of values) {
        if (label === value || label.contains(value) || value.contains(label)) continue;
        const rect = value.getBoundingClientRect();
        const valueY = (rect.top + rect.bottom) / 2;
        const vertical = Math.abs(valueY - labelY);
        if (vertical > 110 || rect.right < labelRect.left - 20) continue;
        matches.push({
          label,
          value,
          score: vertical * 10
            + Math.abs(rect.left - labelRect.right) / 40
            + (rect.width * rect.height) / 100000,
        });
      }
    }
    return matches.sort((a, b) => a.score - b.score)[0] ?? null;
  }

  function masterKbliEmptyMatch(labels) {
    const placeholders = [...document.querySelectorAll("body *")].filter((element) => {
      if (!visible(element)) return false;
      const values = [
        element.getAttribute?.("placeholder"),
        element.getAttribute?.("aria-placeholder"),
        element.getAttribute?.("data-placeholder"),
        leafText(element),
      ].map(normalize).filter(Boolean);
      if (!values.some((value) => value === "PILIH SALAH SATU..."
        || value === "PILIH SALAH SATU…"
        || value.startsWith("PILIH SALAH SATU"))) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 20 && rect.height > 10 && rect.height < 110;
    });

    const matches = [];
    for (const label of labels) {
      const labelRect = label.getBoundingClientRect();
      const labelY = (labelRect.top + labelRect.bottom) / 2;
      for (const placeholder of placeholders) {
        if (label === placeholder || label.contains(placeholder) || placeholder.contains(label)) continue;
        const rect = placeholder.getBoundingClientRect();
        const valueY = (rect.top + rect.bottom) / 2;
        const vertical = Math.abs(valueY - labelY);
        if (vertical > 110 || rect.right < labelRect.left - 20) continue;
        matches.push({
          label,
          value: placeholder,
          score: vertical * 10
            + Math.abs(rect.left - labelRect.right) / 40
            + (rect.width * rect.height) / 100000,
        });
      }
    }
    return matches.sort((a, b) => a.score - b.score)[0] ?? null;
  }

  function clickableMasterValue(value) {
    if (!value) return null;
    const candidates = [];
    let current = value;
    for (let depth = 0; depth < 6 && current; depth += 1, current = current.parentElement) {
      if (!visible(current)) continue;
      const rect = current.getBoundingClientRect();
      if (rect.width < 100 || rect.height < 20 || rect.height > 100) continue;
      const interactive = current.matches(
        "[role='combobox'],[aria-haspopup='listbox'],button,.ant-select-selector,[class*='select']",
      );
      candidates.push({
        element: current,
        score: (interactive ? -1000 : 0) + Math.abs(rect.height - 38) + depth * 2,
      });
    }
    return candidates.sort((a, b) => a.score - b.score)[0]?.element ?? value;
  }

  function masterKbliClearControl(control) {
    if (!control) return null;
    let root = control;
    for (let depth = 0; depth < 6 && root.parentElement; depth += 1) {
      const parent = root.parentElement;
      const rect = parent.getBoundingClientRect();
      if (rect.height > 130) break;
      root = parent;
    }

    const named = [...root.querySelectorAll(
      "[class*='clear' i],[aria-label*='clear' i],[aria-label*='hapus' i],[title*='clear' i],[title*='hapus' i]",
    )]
      .filter(visible)
      .sort((a, b) => {
        const area = (element) => element.getBoundingClientRect().width * element.getBoundingClientRect().height;
        return area(a) - area(b);
      });
    if (named[0]) return clickable(named[0]);

    const rect = control.getBoundingClientRect();
    const centerY = (rect.top + rect.bottom) / 2;
    const positional = [...root.querySelectorAll("button,[role='button'],svg")]
      .filter(visible)
      .map((element) => {
        const itemRect = element.getBoundingClientRect();
        return {
          element,
          rect: itemRect,
          centerX: (itemRect.left + itemRect.right) / 2,
          centerY: (itemRect.top + itemRect.bottom) / 2,
        };
      })
      .filter((item) => Math.abs(item.centerY - centerY) < 28
        && item.centerX > rect.left + rect.width * 0.7
        && item.centerX < rect.right + 30)
      // Ikon hapus berada di sebelah kiri ikon panah pembuka dropdown.
      .sort((a, b) => a.centerX - b.centerX
        || a.rect.width * a.rect.height - b.rect.width * b.rect.height);
    return positional[0] ? clickable(positional[0].element) : null;
  }

  function masterKbliDeleteDialog() {
    const dialogs = [...document.querySelectorAll("[role='dialog']")].filter(visible);
    const direct = dialogs.find((dialog) => {
      const text = normalize(dialog.textContent);
      return text.includes("KONFIRMASI HAPUS PILIHAN")
        || text.includes("MENGHAPUS SEMUA PILIHAN");
    });
    if (direct) return direct;

    const marker = smallestTextElement((value) => value.includes("KONFIRMASI HAPUS PILIHAN"));
    if (!marker) return null;
    let current = marker;
    for (let depth = 0; depth < 8 && current; depth += 1, current = current.parentElement) {
      const buttons = [...current.querySelectorAll("button,[role='button']")].filter(visible);
      const names = buttons.map((button) => normalize(button.textContent));
      if (names.includes("YA") && names.includes("BATAL")) return current;
    }
    return null;
  }

  async function clearExistingMasterKbli(control, targetCode) {
    const current = selectedKbliCode();
    if (!current || current === targetCode) return;
    const clearControl = masterKbliClearControl(control.control);
    if (!clearControl) {
      throw new Error(`Tombol hapus pada input Master KBLI tidak ditemukan. Nilai lama ${current} belum dapat diganti.`);
    }
    dispatchClickOnElement(clearControl);
    const outcome = await waitFor(() => {
      const dialog = masterKbliDeleteDialog();
      if (dialog) return { dialog };
      if (selectedKbliCode() !== current) return { cleared: true };
      return null;
    }, "Dialog konfirmasi hapus pilihan", 10000);
    if (outcome.dialog) {
      const yesButton = [...outcome.dialog.querySelectorAll("button,[role='button']")]
        .find((button) => visible(button) && normalize(button.textContent) === "YA");
      if (!yesButton) throw new Error("Tombol Ya pada dialog Konfirmasi Hapus Pilihan tidak ditemukan.");
      dispatchClickOnElement(yesButton);
    }
    await waitFor(
      () => selectedKbliCode() !== current,
      `Pengosongan KBLI lama ${current}`,
      30000,
    );
  }

  function masterKbliControl() {
    const labels = masterKbliLabels();
    if (!labels.length) return null;

    // Setelah pilihan lama dihapus, FASIH mengganti seluruh komponen Select.
    // Teks "Pilih salah satu..." adalah penanda paling stabil untuk komponen
    // baru tersebut dan harus didahulukan daripada kandidat input lain.
    const emptyMatch = masterKbliEmptyMatch(labels);
    if (emptyMatch) {
      const control = clickableMasterValue(emptyMatch.value);
      return {
        label: emptyMatch.label,
        control,
        input: masterKbliInput(control),
      };
    }

    const selectedValueMatch = masterKbliValueMatch(labels);
    if (selectedValueMatch) {
      const control = clickableMasterValue(selectedValueMatch.value);
      return {
        label: selectedValueMatch.label,
        control,
        input: masterKbliInput(control),
      };
    }

    // Komponen Select FASIH (Ant Design) menyembunyikan input pencarian saat
    // dropdown tertutup. Karena itu deteksi pembungkus visualnya, bukan hanya
    // input yang mempunyai ukuran terlihat.
    const controls = [...new Set([
      ...document.querySelectorAll("[role='combobox']"),
      ...document.querySelectorAll("[aria-haspopup='listbox']"),
      ...document.querySelectorAll(".ant-select-selector"),
      ...document.querySelectorAll("[class*='select-selector']"),
      ...document.querySelectorAll("[class*='select__control']"),
      ...document.querySelectorAll("[class*='select-control']"),
      // Pada beberapa assignment, input Master KBLI tidak mempunyai role
      // combobox maupun class select. Posisi terhadap label menjadi penentu.
      ...document.querySelectorAll("input:not([type='hidden']):not([disabled]),textarea:not([disabled])"),
    ])].filter((element) => {
      if (!visible(element)) return false;
      const rect = element.getBoundingClientRect();
      return rect.width >= 140 && rect.height >= 24 && rect.height <= 100;
    });

    const matches = [];
    for (const label of labels) {
      const labelRect = label.getBoundingClientRect();
      const labelY = (labelRect.top + labelRect.bottom) / 2;
      for (const control of controls) {
        const rect = control.getBoundingClientRect();
        const controlY = (rect.top + rect.bottom) / 2;
        const vertical = Math.abs(controlY - labelY);
        if (vertical > 110 || rect.right < labelRect.left - 20) continue;
        const horizontalGap = Math.max(0, rect.left - labelRect.right);
        const leftPenalty = rect.left < labelRect.left ? 500 : 0;
        matches.push({
          label,
          control,
          score: vertical * 8 + horizontalGap / 30 + leftPenalty,
        });
      }
    }

    let match = matches.sort((a, b) => a.score - b.score)[0];
    if (!match) return null;
    return {
      label: match.label,
      control: match.control,
      input: masterKbliInput(match.control),
    };
  }

  function kbliCategoryValue() {
    const label = questionLabel(["13. H.", "13.H."])
      ?? smallestTextElement((value) => value.includes("13. H") && value.includes("KATEGORI LAPANGAN USAHA"));
    if (!label) return "";
    const input = nearestReadableInput(label);
    return normalize(input?.value ?? input?.textContent);
  }

  function committedMasterKbliCode() {
    // Nilai Master yang sudah dipilih selalu tampil sebagai
    // "[Kategori][Kode] Uraian". Teks pencarian dan rekomendasi radio tidak
    // mempunyai bentuk ini, sehingga ini menjadi verifikasi paling tegas.
    const formattedSelections = [...document.querySelectorAll("body *")]
      .filter(visible)
      .map((element) => {
        const text = normalize([
          element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
            ? element.value
            : "",
          element.textContent,
        ].filter(Boolean).join(" "));
        const match = text.match(/\[([A-Z])\]\s*\[(\d{5})\]/);
        const rect = element.getBoundingClientRect();
        return { element, match, rect };
      })
      .filter((item) => item.match && item.rect.width > 100 && item.rect.height > 10 && item.rect.height < 110);
    // Label field berada paling kiri; teks radio "Pilih dari Master KBLI"
    // berada di sisi kanan. Gunakan label field agar opsi dropdown yang muncul
    // di bawah kotak tidak ikut terbaca sebagai nilai terpilih.
    const fieldLabel = masterKbliLabels()
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)[0];
    const fieldLabelRect = fieldLabel?.getBoundingClientRect();
    const formatted = formattedSelections
      .map((item) => {
        if (!fieldLabelRect) return { ...item, score: Number.POSITIVE_INFINITY };
        const vertical = Math.abs(
          (item.rect.top + item.rect.bottom) / 2
          - (fieldLabelRect.top + fieldLabelRect.bottom) / 2,
        );
        const leftPenalty = item.rect.right < fieldLabelRect.left ? 1000 : 0;
        return { ...item, vertical, score: vertical + leftPenalty + item.rect.width * item.rect.height / 100000 };
      })
      // Opsi pertama dropdown berada di baris berikutnya. Batas rapat ini hanya
      // menerima teks yang benar-benar berada di dalam kotak Master KBLI.
      .filter((item) => item.vertical < 34 && item.score < 80)
      .sort((a, b) => a.score - b.score)[0];
    if (formatted) return formatted.match[2];

    const control = masterKbliControl();
    if (!control) return "";
    const inputValue = normalize(control.input?.value);
    const displayValue = normalize([
      control.control?.textContent,
      control.control?.getAttribute?.("aria-label"),
      // Nilai pencarian yang hanya berisi lima digit belum merupakan pilihan.
      /\D/.test(inputValue) ? inputValue : "",
    ].filter(Boolean).join(" "));
    const code = displayValue.match(/(^|\D)(\d{5})(\D|$)/)?.[2] ?? "";
    return code && kbliCategoryValue() ? code : "";
  }

  function masterKbliTargetSelected(targetCode) {
    if (!/^\d{5}$/.test(String(targetCode))) return false;
    const fieldLabel = masterKbliLabels()
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)[0];
    if (!fieldLabel) return false;
    const labelRect = fieldLabel.getBoundingClientRect();
    const labelY = (labelRect.top + labelRect.bottom) / 2;
    const pattern = new RegExp(`\\[[A-Z]\\]\\s*\\[${targetCode}\\]`);
    return [...document.querySelectorAll("body *")]
      .filter(visible)
      .some((element) => {
        const text = normalize([
          element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
            ? element.value
            : "",
          element.textContent,
        ].filter(Boolean).join(" "));
        if (!pattern.test(text)) return false;
        const rect = element.getBoundingClientRect();
        const centerY = (rect.top + rect.bottom) / 2;
        return Math.abs(centerY - labelY) < 40
          && rect.right > labelRect.right
          && rect.height > 10
          && rect.height < 110;
      });
  }

  function masterKbliOption(targetCode, control) {
    const targetPattern = new RegExp(`(^|\\D)${targetCode}(\\D|$)`);
    const controlRect = control?.control?.getBoundingClientRect?.();
    const candidates = [...new Set([
      ...document.querySelectorAll("[role='option']"),
      ...document.querySelectorAll("li"),
      ...document.querySelectorAll("[class*='option' i]"),
      ...document.querySelectorAll("[class*='menu-item' i]"),
      // Cadangan untuk komponen FASIH tanpa role/class semantik. Geometri di
      // bawah kotak Master KBLI tetap membatasi pencarian ke panel hasil.
      ...document.querySelectorAll("div"),
    ])]
      .filter(visible)
      .filter((element) => {
        const text = normalize(element.textContent);
        if (!targetPattern.test(text) || text === targetCode) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width < 150 || rect.height < 24 || rect.height > 500) return false;
        if (!controlRect) return true;
        return rect.bottom >= controlRect.bottom - 10
          && rect.left < controlRect.right + 80
          && rect.right > controlRect.left - 80;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const semantic = element.getAttribute("role") === "option"
          || /option|menu-item/i.test(String(element.className));
        const vertical = controlRect ? Math.abs(rect.top - controlRect.bottom) : 0;
        return {
          element,
          score: (semantic ? -10000 : 0) + vertical * 10 + rect.width * rect.height / 1000,
        };
      })
      .sort((a, b) => a.score - b.score);
    return candidates[0]?.element ?? null;
  }

  async function closeMasterKbliDropdown(control, input, targetCode) {
    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      keyCode: 27,
      which: 27,
      bubbles: true,
      cancelable: true,
    });
    input?.dispatchEvent(escape);
    input?.blur?.();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

    // Klik label 13.g sebagai area aman di luar dropdown. Berbeda dengan
    // HTMLElement.click(), rangkaian event ini juga ditangkap komponen FASIH
    // sebagai klik-luar sehingga panel opsi ditutup.
    const outside = kbliQuestionLabel();
    if (outside) dispatchClickOnElement(outside);
    await settle(500);

    const refreshed = masterKbliControl();
    const expanded = refreshed?.control?.getAttribute?.("aria-expanded")
      ?? control?.control?.getAttribute?.("aria-expanded");
    if (expanded === "true") {
      refreshed?.control?.dispatchEvent(escape);
      refreshed?.input?.blur?.();
      if (outside) dispatchClickOnElement(outside);
      await settle(500);
    }

    // FASIH tidak selalu menutup panel dari event blur/Escape sintetis.
    // Klik tombol panah paling kanan pada kotak Select sebagai penutup yang
    // sama dengan tindakan manual pengguna.
    const targetValue = masterKbliValueMatch(masterKbliLabels(), targetCode);
    const targetControl = targetValue ? clickableMasterValue(targetValue.value) : null;
    const latest = masterKbliControl() ?? refreshed ?? control;
    // Gunakan kotak yang benar-benar memuat target. Ketika panel terbuka,
    // masterKbliControl dapat melihat opsi pertama sebagai kontrol terdekat.
    const anchor = targetControl ?? latest?.control ?? control?.control;
    const panelIsOpen = (field) => {
      if (!field) return false;
      const expandedValue = field.getAttribute?.("aria-expanded")
        ?? field.querySelector?.("[aria-expanded]")?.getAttribute("aria-expanded");
      if (expandedValue === "true") return true;
      const fieldRect = field.getBoundingClientRect();
      return [...document.querySelectorAll("[role='listbox'],[class*='dropdown' i],[class*='menu' i],body *")]
        .filter(visible)
        .some((element) => {
          const text = normalize(element.textContent);
          const optionCount = [...text.matchAll(/\[[A-Z]\]\s*\[\d{5}\]/g)].length;
          if (optionCount < 2) return false;
          const rect = element.getBoundingClientRect();
          return rect.top >= fieldRect.bottom - 15
            && rect.left < fieldRect.right + 80
            && rect.right > fieldRect.left - 80
            && rect.height > 50;
        });
    };
    if (anchor && panelIsOpen(anchor)) {
      let root = anchor;
      for (let depth = 0; depth < 6 && root.parentElement; depth += 1) {
        const parent = root.parentElement;
        const rect = parent.getBoundingClientRect();
        if (rect.height > 120) break;
        root = parent;
      }
      const anchorRect = anchor.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      const centerY = (anchorRect.top + anchorRect.bottom) / 2;
      const toggle = [...root.querySelectorAll("button,[role='button'],svg")]
        .filter(visible)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            element,
            rect,
            centerX: (rect.left + rect.right) / 2,
            centerY: (rect.top + rect.bottom) / 2,
          };
        })
        .filter((item) => Math.abs(item.centerY - centerY) < 28
          && item.centerX >= Math.max(anchorRect.left, rootRect.right - 90)
          && item.centerX <= rootRect.right + 5)
        .sort((a, b) => b.centerX - a.centerX)[0];
      if (toggle) {
        dispatchClickOnElement(clickable(toggle.element));
        await settle(500);
      }
    }
  }

  function selectedKbliCode(expectedCode = "") {
    if (expectedCode && masterKbliTargetSelected(expectedCode)) return String(expectedCode);
    // Jika field Master terlihat, berisi label KBLI lengkap, dan 13.h sudah
    // terisi, nilai itu adalah sumber kebenaran. State `checked` radio FASIH
    // kadang masih menunjuk rekomendasi terakhir walaupun UI sudah menampilkan
    // radio Master aktif; akibatnya kode seperti 01286 terbaca menggantikan
    // nilai Master yang sebenarnya sudah dipilih (mis. 38110).
    const committedMaster = committedMasterKbliCode();
    if (committedMaster) return committedMaster;

    const selectedRadio = kbliRadioChoices().find((choice) => choice.input.checked);
    // Periksa radio Master terlebih dahulu. Parent radio pada sebagian halaman
    // juga memuat seluruh teks rekomendasi sehingga regex pertama dapat keliru
    // membaca kode rekomendasi lain (mis. 01283) sebagai pilihan aktif.
    if (isMasterKbliChoice(selectedRadio)) {
      return committedMasterKbliCode();
    }
    const direct = selectedRadio?.text.match(/\b\d{5}\b/)?.[0];
    if (direct) return direct;
    return "";
  }

  async function ensureKbliChoices() {
    if (kbliRadioChoices().length) return;
    const button = [...document.querySelectorAll("button,[role='button']")]
      .find((element) => visible(element) && normalize(element.textContent).includes("DAPATKAN REKOMENDASI KBLI"));
    if (!button) throw new Error("Tombol Dapatkan Rekomendasi KBLI tidak ditemukan.");
    button.click();
    await waitFor(() => kbliRadioChoices().length > 0, "Pilihan rekomendasi KBLI", 120000);
  }

  async function chooseMasterKbli(targetCode) {
    const masterChoice = kbliRadioChoices().find(isMasterKbliChoice);
    if (!masterChoice) throw new Error("Pilihan 'Pilih dari Master KBLI' tidak ditemukan.");
    clickRadio(masterChoice);
    // Beberapa versi FASIH telah memilih nilai target sebelum pembungkus
    // dropdown selesai diberi atribut. Jangan menunggu kontrol jika kode yang
    // terlihat sudah benar.
    // Jangan menganggap angka lima digit yang baru diketik sebagai pilihan.
    // Hanya label lengkap [Kategori][Kode] pada kotak utama yang boleh
    // melewati proses pencarian dan klik opsi dropdown.
    if (selectedKbliCode(targetCode) === targetCode) return;
    let control = await waitFor(
      masterKbliControl,
      `Dropdown Master KBLI (ekstensi ${contentVersion})`,
      30000,
    );
    if (selectedKbliCode(targetCode) === targetCode) return;

    await clearExistingMasterKbli(control, targetCode);
    // Jangan gunakan kembali node lama: komponen Select dirender ulang setelah
    // konfirmasi hapus. Tunggu kotak kosong "Pilih salah satu..." muncul.
    control = await waitFor(() => {
      const refreshed = masterKbliControl();
      if (!refreshed?.control || !refreshed.control.isConnected) return null;
      return refreshed;
    }, "Area 'Pilih salah satu...' Master KBLI", 15000);
    dispatchClickOnElement(control.control);
    await settle(300);
    const input = await waitFor(() => {
      const refreshed = masterKbliControl();
      const focused = document.activeElement instanceof HTMLInputElement
        || document.activeElement instanceof HTMLTextAreaElement
        ? document.activeElement
        : null;
      const focusedNearMaster = focused && refreshed?.label
        && nearestInputFrom(refreshed.label, [focused]) === focused;
      const candidate = (focusedNearMaster ? focused : null)
        ?? refreshed?.input
        ?? masterKbliInput(refreshed?.control);
      if (candidate) return candidate;
      return document.activeElement instanceof HTMLInputElement ? document.activeElement : null;
    }, "Input pencarian Master KBLI", 15000);
    input.focus();
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (!setter) throw new Error("Setter input pencarian Master KBLI tidak tersedia.");
    const previousValue = input.value;
    setter.call(input, targetCode);
    if (input._valueTracker?.setValue) input._valueTracker.setValue(previousValue);
    input.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      composed: true,
      inputType: "insertReplacementText",
      data: targetCode,
    }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const option = await waitFor(() => masterKbliOption(targetCode, control), `Pilihan KBLI ${targetCode}`, 30000);
    // Klik baris opsi lengkap, bukan teks kode di dalamnya. Komponen FASIH
    // memasang handler pemilihan pada kartu opsi sehingga klik pada teks saja
    // dapat meninggalkan angka sebagai kata pencarian tanpa memilih KBLI.
    dispatchClickOnElement(option);
    await waitFor(
      () => masterKbliTargetSelected(targetCode),
      `Konfirmasi pilihan KBLI ${targetCode} dan pengisian kategori 13.h`,
      30000,
    );
    // Pada titik ini FASIH sudah menerima pilihan: kotak utama menampilkan
    // label lengkap [Kategori][Kode] Uraian. Panel dropdown yang masih terbuka
    // hanyalah keadaan visual dan opsi pertamanya bukan nilai terpilih.
    // Penutupan dilakukan sebagai best effort; jangan membaca ulang panel atau
    // menggagalkan proses karena opsi pertama di dalamnya.
    await closeMasterKbliDropdown(control, input, targetCode);
  }

  async function chooseKbli(targetCode) {
    await ensureKbliChoices();
    const direct = kbliRadioChoices().find((choice) => !isMasterKbliChoice(choice)
      && choice.text.match(/\b\d{5}\b/)?.[0] === targetCode);
    if (direct) {
      clickRadio(direct);
      await waitFor(() => selectedKbliCode(targetCode) === targetCode, `Verifikasi pilihan rekomendasi ${targetCode}`, 20000);
    } else {
      await chooseMasterKbli(targetCode);
    }
    const label = kbliQuestionLabel();
    const selected = kbliRadioChoices().find((choice) => choice.input.checked);
    const control = isMasterKbliChoice(selected)
      ? (masterKbliControl()?.control ?? masterKbliControl()?.input)
      : selected?.input;
    if (!label || !control) throw new Error("Kontrol KBLI terpilih tidak dapat diverifikasi.");
    // Pemilihan sudah diverifikasi di dalam cabang direct/master. Bawa hasil
    // tersebut ke proses remark agar panel dropdown yang masih terbuka tidak
    // dipindai ulang dan opsi pertamanya tidak disangka sebagai nilai aktif.
    return { label, input: control, verifiedCode: targetCode };
  }

  function currentKbliRemarkItem() {
    const label = kbliQuestionLabel();
    if (!label) return null;
    const selected = kbliRadioChoices().find((choice) => choice.input.checked);
    const master = masterKbliControl();
    return {
      label,
      // Untuk #0 tidak diperlukan perubahan nilai. Label 13.g sendiri cukup
      // sebagai jangkar posisi jika kontrol pilihan tidak dapat dibaca.
      input: master?.control ?? master?.input ?? selected?.input ?? label,
    };
  }

  async function verifyPersistedKbli(payload) {
    const keepExisting = payload?.keepExistingKbli === true || String(payload?.remark) === "#0";
    showPageNotice(keepExisting
      ? `Memeriksa penyelesaian remark #0 untuk ${payload.businessName}…`
      : `Memeriksa ulang KBLI ${payload.targetCode} untuk ${payload.businessName}…`);
    await openBusiness(payload);
    await settle(1200);
    if (!keepExisting) {
      const actual = selectedKbliCode(String(payload.targetCode));
      if (actual !== String(payload.targetCode)) {
        throw new PersistedValuesMismatch(`KBLI FASIH belum tersimpan sesuai target: target ${payload.targetCode}, tersimpan ${actual || "(kosong)"}. Status Excel belum ditulis.`, [actual]);
      }
    }
    const item = currentKbliRemarkItem();
    if (!item) throw new Error("Rincian 13.g tidak ditemukan saat verifikasi.");
    return {
      q13g: item,
    };
  }

  async function verifyPersistedValues(payload) {
    if (payload?.kind === "kbli") return verifyPersistedKbli(payload);
    if (!payload?.values) throw new Error("Paket nilai untuk verifikasi penyimpanan tidak tersedia.");
    showPageNotice(`Memeriksa ulang nilai tersimpan untuk ${payload.businessName}…`);
    await openBusiness(payload);
    await settle(1000);
    const fields = locateReadableFields();
    const missing = Object.entries(fields)
      .filter(([key, item]) => !item.input && !optionalFieldKeys.has(key))
      .map(([key]) => key);
    if (missing.length) throw new Error(`Field verifikasi tidak ditemukan: ${missing.join(", ")}`);

    const mismatches = [];
    for (const key of Object.keys(fieldMap)) {
      const item = fields[key];
      if (!item?.input) continue;
      const expected = digits(payload.values[key], isMonthlyBranch(item) ? 12 : 1);
      const actual = digits(item.input.value);
      if (actual !== expected) mismatches.push(`${key} target ${expected}, tersimpan ${actual}`);
    }
    if (mismatches.length) throw new PersistedValuesMismatch(
      `Nilai FASIH belum tersimpan sesuai rekomendasi: ${mismatches.join("; ")}. Status spreadsheet belum ditulis.`,
      mismatches,
    );
    return fields;
  }

  function restartAfterPersistenceMismatch(error) {
    if (error?.code !== "PERSISTED_VALUES_MISMATCH") return false;
    const job = activeAutoJob();
    if (!job?.requestId || !job?.payload) return false;
    const restartCount = Number(job.persistenceRestartCount ?? 0);
    if (restartCount >= maxPersistenceRestarts) return false;
    const restartedJob = {
      ...job,
      persistenceRestartCount: restartCount + 1,
      createdAt: Date.now(),
    };
    sessionStorage.setItem(pendingUrlJobKey, JSON.stringify(restartedJob));
    sessionStorage.setItem(activeAutoJobKey, JSON.stringify(restartedJob));
    sessionStorage.removeItem(pendingKey);
    sessionStorage.removeItem(pendingReviewKey);
    sessionStorage.removeItem(pendingApprovalKey);
    showPageNotice(
      `Nilai tersimpan belum sesuai. Memilih ulang usaha dan mengulang pengisian (${restartCount + 1}/${maxPersistenceRestarts})…`,
    );
    location.replace(assignmentUrlWithoutEdit());
    return true;
  }

  async function setVerifiedFieldValue(key, expected) {
    let lastValue = "(field tidak ditemukan)";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const item = locateFields()[key];
      if (!item?.input) throw new Error(`Field ${key} hilang saat akan diisi.`);
      // Mengubah property `value` saja dapat membuat angka terlihat benar,
      // tetapi state formulir FASIH masih menyimpan nilai lama. Background
      // memasukkan angka sebagai keyboard input tepercaya dan menekan Tab,
      // sehingga payload Kirim memakai nilai yang sama dengan yang terlihat.
      await setTrustedFieldValue(item.input, expected);

      // FASIH merender ulang komponen input setelah event change/blur. Membaca
      // langsung elemen lama dapat memberi hasil positif palsu, jadi selalu
      // cari kembali input aktif setelah render sempat selesai.
      await settle(900);
      const latest = locateFields()[key];
      lastValue = latest?.input ? digits(latest.input.value) : "(field tidak ditemukan)";
      if (latest?.input && lastValue === expected) {
        latest.input.style.outline = "3px solid #f97316";
        latest.input.style.outlineOffset = "2px";
        return latest;
      }
    }
    throw new Error(`Perubahan ${key} tidak tersimpan di FASIH. Target ${expected}, tetapi nilai yang terbaca kembali ${lastValue}.`);
  }

  async function verifyChangedFields(changed, delayMs = 750) {
    if (!changed.length) return locateFields();
    await settle(delayMs);
    const latestFields = locateFields();
    for (const entry of changed) {
      const current = latestFields[entry.key]?.input
        ? digits(latestFields[entry.key].input.value)
        : "(field tidak ditemukan)";
      if (current !== entry.expected) {
        throw new Error(`Verifikasi akhir ${entry.key} gagal. Target ${entry.expected}, tetapi FASIH membaca ${current}. Proses dihentikan sebelum remark dan Kirim.`);
      }
    }
    return latestFields;
  }

  function nearestRemarkButton(item) {
    const labelRect = item.label.getBoundingClientRect();
    const labelY = (labelRect.top + labelRect.bottom) / 2;
    const allButtons = [...document.querySelectorAll("button,[role='button']")].filter(visible);
    const named = allButtons
      .filter((element) => accessibleName(element).includes("CATATAN"))
      .map((button) => {
        const rect = button.getBoundingClientRect();
        const buttonY = (rect.top + rect.bottom) / 2;
        const horizontalPenalty = rect.right < labelRect.left ? 500 : 0;
        return { button, score: Math.abs(buttonY - labelY) + horizontalPenalty };
      })
      .sort((a, b) => a.score - b.score);
    if (named[0]?.score < 150) return named[0].button;

    // Cadangan untuk ikon tanpa atribut nama: pilih tombol aksi eksternal
    // pada baris yang sama, di sebelah kanan kontrol nilai. Tombol panah
    // Decrement/Increment dan Tampilan Batch tidak boleh dipilih.
    const inputRect = item.input.getBoundingClientRect();
    const inputY = (inputRect.top + inputRect.bottom) / 2;
    const positional = allButtons
      .filter((button) => {
        const name = accessibleName(button);
        const rect = button.getBoundingClientRect();
        const buttonY = (rect.top + rect.bottom) / 2;
        return rect.left > inputRect.right
          && Math.abs(buttonY - inputY) < 70
          && !/DECREMENT|INCREMENT|TAMPILAN BATCH/.test(name);
      })
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    return positional[0] ?? null;
  }

  function remarkEditor() {
    return [...document.querySelectorAll("textarea,input,[contenteditable='true']")]
      .find((element) => visible(element) && normalize(element.getAttribute("placeholder")).includes("TAMBAH CATATAN")) ?? null;
  }

  function visibleRemark(remark) {
    const wanted = normalize(remark);
    return textCandidates().some((element) => leafText(element) === wanted);
  }

  function modalContainer(editor) {
    const ancestors = [];
    let current = editor;
    for (let depth = 0; depth < 12 && current; depth += 1, current = current.parentElement) ancestors.push(current);
    const roleDialog = ancestors.find((element) => element.getAttribute?.("role") === "dialog");
    if (roleDialog) return roleDialog;

    const bounded = ancestors
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return normalize(element.textContent).includes("CATATAN")
          && rect.width >= 280 && rect.width <= Math.min(1000, window.innerWidth * 0.95)
          && rect.height >= 250 && rect.height <= window.innerHeight * 0.95;
      })
      .sort((a, b) => {
        const area = (element) => element.getBoundingClientRect().width * element.getBoundingClientRect().height;
        return area(a) - area(b);
      });
    return bounded[0] ?? editor.parentElement;
  }

  function nearestButtonTo(editor, panel, excluded = new Set()) {
    const rect = editor.getBoundingClientRect();
    return [...panel.querySelectorAll("button,[role='button']")]
      .filter((button) => visible(button) && !excluded.has(button))
      .map((button) => {
        const buttonRect = button.getBoundingClientRect();
        return { button, score: Math.hypot(buttonRect.left + buttonRect.width / 2 - rect.right, buttonRect.top + buttonRect.height / 2 - rect.bottom) };
      })
      .sort((a, b) => a.score - b.score)[0]?.button ?? null;
  }

  function dispatchClickAt(x, y) {
    const target = document.elementFromPoint(x, y);
    if (!target) return false;
    const init = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
    if (typeof PointerEvent === "function") {
      target.dispatchEvent(new PointerEvent("pointerdown", init));
      target.dispatchEvent(new PointerEvent("pointerup", init));
    }
    target.dispatchEvent(new MouseEvent("mousedown", init));
    target.dispatchEvent(new MouseEvent("mouseup", init));
    target.dispatchEvent(new MouseEvent("click", init));
    return true;
  }

  async function closeRemarkPanel(panel, editor, sendButton) {
    const rect = panel.getBoundingClientRect();

    // Nama aksesibilitas ikon X pada FASIH adalah "Dismiss".
    const dismissButton = [...document.querySelectorAll("button,[role='button'],[aria-label],[title]")]
      .filter((element) => visible(element) && /(^| )(DISMISS|CLOSE|TUTUP)( |$)/.test(accessibleName(element)))
      .sort((a, b) => {
        const aRect = a.getBoundingClientRect();
        const bRect = b.getBoundingClientRect();
        const score = (buttonRect) => Math.hypot(buttonRect.right - rect.right, buttonRect.top - rect.top);
        return score(aRect) - score(bRect);
      })[0];
    if (dismissButton) {
      dismissButton.click();
      try {
        await waitFor(() => !visible(editor), "Penutupan remark", 2500);
        return;
      } catch {
        // Lanjutkan dengan posisi ikon jika tombol tidak merespons.
      }
    }

    // Pada FASIH ikon X tidak selalu memiliki aria-label/role button.
    // Posisinya konsisten di pojok kanan atas dialog Catatan.
    const closeX = rect.right - 23;
    const closeY = rect.top + 23;
    const hit = document.elementFromPoint(closeX, closeY);
    if (hit && panel.contains(hit)) {
      dispatchClickAt(closeX, closeY);
      try {
        await waitFor(() => !visible(editor), "Penutupan remark", 2500);
        return;
      } catch {
        // Lanjutkan dengan pencarian elemen DOM sebagai cadangan.
      }
    }

    const targets = [...new Set([...panel.querySelectorAll("button,[role='button'],[aria-label],[title],svg")]
      .map((element) => clickable(element))
      .filter(Boolean))];
    const candidates = targets
      .filter((button) => visible(button) && button !== sendButton && !sendButton?.contains(button))
      .map((button) => {
        const buttonRect = button.getBoundingClientRect();
        const aria = accessibleName(button);
        const labelBonus = /CLOSE|TUTUP/.test(aria) ? -1000 : 0;
        return {
          button,
          score: Math.hypot(
            buttonRect.left + buttonRect.width / 2 - (rect.right - 24),
            buttonRect.top + buttonRect.height / 2 - (rect.top + 24),
          ) + labelBonus,
        };
      })
      .sort((a, b) => a.score - b.score);
    if (candidates[0]) {
      const target = candidates[0].button;
      if (typeof target.click === "function") target.click();
      else target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      try {
        await waitFor(() => !visible(editor), "Penutupan remark", 2500);
        return;
      } catch {
        // Coba Escape bila komponen tidak merespons klik DOM.
      }
    }
    const escape = new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true });
    document.dispatchEvent(escape);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
    await waitFor(() => !visible(editor), "Penutupan remark", 8000);
  }

  async function addRemark(key, item, remark) {
    const remarkButton = nearestRemarkButton(item);
    if (!remarkButton) throw new Error(`Tombol Catatan ${key} tidak ditemukan.`);
    remarkButton.click();
    const editor = await waitFor(remarkEditor, `Kotak remark ${key}`);
    const panel = modalContainer(editor);
    if (visibleRemark(remark)) {
      await closeRemarkPanel(panel, editor, null);
      return "sudah ada";
    }
    setFrameworkValue(editor, remark);
    const sendButton = nearestButtonTo(editor, panel);
    if (!sendButton) throw new Error(`Tombol kirim remark ${key} tidak ditemukan.`);
    sendButton.click();
    await waitFor(() => visibleRemark(remark) || !visible(editor), `Pengiriman remark ${key}`);
    if (visible(editor)) {
      await closeRemarkPanel(panel, editor, sendButton);
    }
    return "ditambahkan";
  }

  function openSubmitSummary() {
    const buttons = [...document.querySelectorAll("button,[role='button']")]
      .filter((button) => visible(button) && normalize(button.textContent) === "KIRIM")
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    if (!buttons.length) throw new Error("Tombol Kirim tidak ditemukan.");
    buttons[0].click();
  }

  function submitDialog() {
    const roleDialogs = [...document.querySelectorAll("[role='dialog']")]
      .filter((element) => visible(element) && normalize(element.textContent).includes("KIRIM"));
    if (roleDialogs.length) return roleDialogs.sort((a, b) => {
      const area = (element) => element.getBoundingClientRect().width * element.getBoundingClientRect().height;
      return area(a) - area(b);
    })[0];

    const markers = textCandidates().filter((element) => leafText(element) === "GALAT");
    for (const marker of markers) {
      let current = marker;
      for (let depth = 0; depth < 10 && current; depth += 1, current = current.parentElement) {
        const text = normalize(current.textContent);
        const hasFinalButton = [...current.querySelectorAll("button,[role='button']")]
          .some((button) => visible(button) && normalize(button.textContent) === "KIRIM");
        if (text.includes("PERINGATAN") && hasFinalButton) return current;
      }
    }
    return null;
  }

  function submitErrorCount(dialog) {
    const errorCard = submitErrorCard(dialog);
    if (errorCard) {
      const cardMatch = accessibleName(errorCard).match(/GALAT\D{0,40}(\d+)/);
      if (cardMatch) return Number.parseInt(cardMatch[1], 10);
    }
    const match = normalize(dialog.textContent).match(/GALAT\D{0,40}(\d+)/);
    return match ? Number.parseInt(match[1], 10) : null;
  }

  function submitErrorCard(dialog) {
    return [...dialog.querySelectorAll("button,[role='button']")]
      .find((element) => accessibleName(element).includes("GALAT")) ?? null;
  }

  function errorListDialog() {
    const candidates = [...document.querySelectorAll("[role='dialog'],body *")]
      .filter((element) => {
        if (!visible(element)) return false;
        const text = normalize(element.textContent);
        return text.includes("GALAT") && text.includes("TOTAL") && text.includes("WAJIB DIISI");
      })
      .sort((a, b) => {
        const area = (element) => element.getBoundingClientRect().width * element.getBoundingClientRect().height;
        return area(a) - area(b);
      });
    return candidates[0] ?? null;
  }

  function errorNavigateButton(dialog) {
    const required = [...dialog.querySelectorAll("*")]
      .filter((element) => visible(element) && leafText(element).includes("WAJIB DIISI"))
      .sort((a, b) => {
        const area = (element) => element.getBoundingClientRect().width * element.getBoundingClientRect().height;
        return area(a) - area(b);
      })[0];
    let current = required;
    for (let depth = 0; depth < 8 && current && dialog.contains(current); depth += 1, current = current.parentElement) {
      const buttons = [...current.querySelectorAll("button,[role='button']")]
        .filter((button) => visible(button) && !/(DISMISS|CLOSE|TUTUP)/.test(accessibleName(button)))
        .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right);
      if (buttons.length) return buttons[0];
    }
    return null;
  }

  function anomalySwitch() {
    const label = smallestTextElement((value) => value === "TAMPILKAN ANOMALI USAHA DAN KELUARGA");
    if (!label) return null;
    const labelRect = label.getBoundingClientRect();
    const labelY = (labelRect.top + labelRect.bottom) / 2;
    const candidates = [...document.querySelectorAll("[role='switch'],input[type='checkbox']")]
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const y = (rect.top + rect.bottom) / 2;
        const leftPenalty = rect.right < labelRect.left ? 500 : 0;
        return { element, score: Math.abs(y - labelY) + leftPenalty };
      })
      .sort((a, b) => a.score - b.score);
    return candidates[0]?.score < 160 ? candidates[0].element : null;
  }

  function switchIsOn(element) {
    return element.checked === true
      || element.getAttribute("aria-checked") === "true"
      || element.getAttribute("data-state") === "checked"
      || normalize(element.getAttribute("class")).includes("CHECKED");
  }

  async function resolveSingleRequiredError(dialog) {
    const errorCard = submitErrorCard(dialog);
    if (!errorCard) throw new Error("Kartu Galat tidak ditemukan.");
    showPageNotice("Galat 1. Membuka rincian galat…");
    errorCard.click();

    const listDialog = await waitFor(errorListDialog, "Daftar Galat", 15000);
    const navigateButton = errorNavigateButton(listDialog);
    if (!navigateButton) throw new Error("Tombol navigasi pada rincian galat tidak ditemukan.");
    navigateButton.click();

    const toggle = await waitFor(anomalySwitch, "Toggle Tampilkan Anomali Usaha dan Keluarga", 15000);
    if (!switchIsOn(toggle)) {
      showPageNotice("Mengaktifkan toggle yang wajib diisi…");
      toggle.click();
      await waitFor(() => switchIsOn(toggle), "Aktivasi toggle wajib", 10000);
    }
    showPageNotice("Toggle wajib aktif. Memeriksa ulang galat…");
  }

  function confirmationDialog() {
    const marker = smallestTextElement((value) => value.includes("KONFIRMASI KIRIM"));
    let current = marker;
    for (let depth = 0; depth < 10 && current; depth += 1, current = current.parentElement) {
      const hasConfirm = [...current.querySelectorAll("button,[role='button']")]
        .some((button) => visible(button) && normalize(button.textContent) === "KONFIRMASI");
      if (hasConfirm) return current;
    }
    return null;
  }

  function unsavedChangesDialog() {
    const dialogs = [...document.querySelectorAll("[role='dialog']")].filter(visible);
    const roleDialog = dialogs.find((element) => {
      const text = normalize(element.textContent);
      return text.includes("MENINGGALKAN HALAMAN")
        && text.includes("PERUBAHAN YANG BELUM DISIMPAN");
    });
    if (roleDialog) return roleDialog;

    const marker = smallestTextElement((value) => value.includes("MENINGGALKAN HALAMAN"));
    let current = marker;
    for (let depth = 0; depth < 10 && current; depth += 1, current = current.parentElement) {
      const names = [...current.querySelectorAll("button,[role='button']")]
        .filter(visible)
        .map((button) => normalize(button.textContent));
      if (names.includes("BATAL") && names.includes("TINGGALKAN")) return current;
    }
    return null;
  }

  async function cancelUnsavedLeave(dialog) {
    const cancelButton = [...dialog.querySelectorAll("button,[role='button']")]
      .find((button) => visible(button) && normalize(button.textContent) === "BATAL");
    if (cancelButton) {
      cancelButton.click();
      // FASIH dapat memakai ulang container yang sama untuk dialog berikutnya.
      // Tunggu sampai jenis dialog "meninggalkan halaman" hilang, bukan sampai
      // node lama disembunyikan.
      await waitFor(() => !unsavedChangesDialog(), "Penutupan dialog meninggalkan halaman", 10000);
    }
    const sendDialog = confirmationDialog();
    if (sendDialog) {
      const sendCancel = [...sendDialog.querySelectorAll("button,[role='button']")]
        .find((button) => visible(button) && normalize(button.textContent) === "BATAL");
      if (sendCancel) {
        sendCancel.click();
        // FASIH memakai ulang container dialog yang sama: sesudah Konfirmasi
        // Kirim dibatalkan, container berubah menjadi ringkasan Kirim dan tetap
        // terlihat. Periksa isi/jenis dialog, bukan visibilitas node lama.
        await waitFor(() => !confirmationDialog(), "Penutupan Konfirmasi Kirim", 10000);
      }
    }
    const summaryDialog = submitDialog();
    if (summaryDialog) {
      const summaryCancel = [...summaryDialog.querySelectorAll("button,[role='button']")]
        .find((button) => visible(button) && normalize(button.textContent) === "BATAL");
      if (summaryCancel) {
        summaryCancel.click();
        await waitFor(() => !submitDialog(), "Penutupan ringkasan Kirim", 10000);
      }
    }
    throw new Error("FASIH mendeteksi perubahan belum tersimpan dan mencoba meninggalkan mode edit. Dialog dibatalkan; assignment tidak dikirim agar data tidak hilang.");
  }

  function approvalDialog() {
    const dialogs = [...document.querySelectorAll("[role='dialog']")]
      .filter((element) => visible(element));
    const roleDialog = dialogs.find((element) => {
      const text = normalize(element.textContent);
      const hasConfirm = [...element.querySelectorAll("button,[role='button']")]
        .some((button) => visible(button) && normalize(button.textContent) === "KONFIRMASI");
      return hasConfirm && (text.includes("APPROVE ASSIGNMENT") || text.includes("APPROVE ASSIGNMENT?"));
    });
    if (roleDialog) return roleDialog;

    const marker = smallestTextElement((value) => value.includes("APPROVE ASSIGNMENT"));
    let current = marker;
    for (let depth = 0; depth < 10 && current; depth += 1, current = current.parentElement) {
      const hasConfirm = [...current.querySelectorAll("button,[role='button']")]
        .some((button) => visible(button) && normalize(button.textContent) === "KONFIRMASI");
      if (hasConfirm) return current;
    }
    return null;
  }

  function submissionSucceeded() {
    return textCandidates().some((element) => {
      const text = leafText(element);
      return text.includes("ASSIGNMENT BERHASIL DISUBMIT")
        || text.includes("PERUBAHAN ANDA BERHASIL DISIMPAN");
    });
  }

  function successDialog() {
    const roleDialog = [...document.querySelectorAll("[role='dialog']")]
      .find((element) => visible(element) && normalize(element.textContent).includes("ASSIGNMENT BERHASIL DISUBMIT"));
    if (roleDialog) return roleDialog;

    const marker = smallestTextElement((value) => value.includes("ASSIGNMENT BERHASIL DISUBMIT"));
    let current = marker;
    for (let depth = 0; depth < 10 && current; depth += 1, current = current.parentElement) {
      const hasReviewButton = [...current.querySelectorAll("button,[role='button']")]
        .some((button) => visible(button) && normalize(button.textContent) === "KEMBALI KE REVIEW");
      if (hasReviewButton) return current;
    }
    return null;
  }

  function greenChannel(element) {
    const colors = [element, ...element.querySelectorAll("*")]
      .slice(0, 8)
      .map((node) => getComputedStyle(node).backgroundColor);
    for (const color of colors) {
      const match = String(color).match(/rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)/i);
      if (!match) continue;
      const [, red, green, blue] = match.map(Number);
      if (green >= 105 && green > red * 1.2 && green > blue * 1.12) return green;
    }
    return 0;
  }

  function findReviewCheckButton() {
    if (/\/edit\/?$/i.test(location.pathname)) return null;
    const buttons = [...document.querySelectorAll("button,[role='button']")].filter(visible);
    const semantic = buttons.find((button) => {
      const name = accessibleName(button);
      return /(^| )(CENTANG|CHECK|SETUJUI|APPROVE|TERIMA|SELESAI)( |$)/.test(name)
        && !/(BATAL|HAPUS|TUTUP|KEMBALI)/.test(name);
    });
    if (semantic) return semantic;

    const railButtons = buttons.filter((button) => {
      const rect = button.getBoundingClientRect();
      return rect.right > window.innerWidth - 180
        && rect.top > window.innerHeight * 0.45
        && rect.width >= 28 && rect.width <= 100
        && rect.height >= 28 && rect.height <= 100;
    });
    const green = railButtons
      .map((button) => ({ button, score: greenChannel(button) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.button;
    if (green) return green;

    // Panel aksi FASIH menempatkan tombol pensil paling bawah dan tombol
    // centang tepat di atasnya. Cadangan ini hanya dipakai pada halaman review.
    return railButtons
      .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[1] ?? null;
  }

  async function returnToReviewAfterSubmit() {
    const dialog = await waitFor(successDialog, "Dialog Assignment Berhasil Disubmit", 30000);
    const reviewButton = [...dialog.querySelectorAll("button,[role='button']")]
      .find((button) => visible(button) && normalize(button.textContent) === "KEMBALI KE REVIEW");
    if (!reviewButton) throw new Error("Tombol Kembali ke Review tidak ditemukan.");
    sessionStorage.setItem(pendingReviewKey, JSON.stringify({
      savedAt: Date.now(),
      jobId: activeAutoJobId(),
    }));
    showPageNotice("Submit berhasil. Kembali ke halaman review…", "success");
    reviewButton.click();

    // Navigasi FASIH dapat berupa SPA tanpa memuat ulang content script.
    setTimeout(resumeAfterReviewNavigation, 350);
  }

  async function submitFinal() {
    let dialog = await waitFor(submitDialog, "Ringkasan Kirim");
    let errorCount = submitErrorCount(dialog);
    if (errorCount === null) {
      throw new Error("Jumlah galat pada ringkasan tidak dapat dibaca. Kirim final dibatalkan.");
    }
    if (errorCount === 1) {
      await resolveSingleRequiredError(dialog);
      openSubmitSummary();
      dialog = await waitFor(submitDialog, "Ringkasan Kirim setelah perbaikan", 15000);
      errorCount = submitErrorCount(dialog);
      if (errorCount === null) throw new Error("Jumlah galat setelah perbaikan tidak dapat dibaca.");
    }
    if (errorCount > 1) {
      throw new MultipleErrorsFound(errorCount);
    }
    if (errorCount > 0) {
      throw new Error(`Masih ada ${errorCount} galat. Kirim final dibatalkan agar data dapat diperiksa.`);
    }
    const finalButton = [...dialog.querySelectorAll("button,[role='button']")]
      .find((button) => visible(button) && normalize(button.textContent) === "KIRIM");
    if (!finalButton) throw new Error("Tombol Kirim final tidak ditemukan.");
    showPageNotice("Galat 0. Membuka konfirmasi pengiriman…");
    finalButton.click();
    const nextStep = await waitFor(
      () => submissionSucceeded() || unsavedChangesDialog() || confirmationDialog(),
      "Konfirmasi Kirim",
      15000,
    );
    if (nextStep === true) {
      await returnToReviewAfterSubmit();
      return;
    }
    if (normalize(nextStep.textContent).includes("MENINGGALKAN HALAMAN")) {
      await cancelUnsavedLeave(nextStep);
    }
    const confirmButton = [...nextStep.querySelectorAll("button,[role='button']")]
      .find((button) => visible(button) && normalize(button.textContent) === "KONFIRMASI");
    if (!confirmButton) throw new Error("Tombol Konfirmasi tidak ditemukan.");
    showPageNotice("Mengonfirmasi pengiriman…");
    confirmButton.click();
    const submitOutcome = await waitFor(
      () => submissionSucceeded() || unsavedChangesDialog(),
      "Konfirmasi keberhasilan pengiriman",
      30000,
    );
    if (submitOutcome !== true) await cancelUnsavedLeave(submitOutcome);
    await returnToReviewAfterSubmit();
  }

  function scanMessage() {
    const fields = locateFields();
    const found = Object.entries(fields).filter(([, item]) => item.input);
    if (!found.length) return "Rincian 26–27 atau 30–31 belum terlihat. Jalankan ‘Buka & isi nilai’ atau buka rincian usaha terlebih dahulu.";
    return found.map(([key, item]) => `${key}: ${item.input.value}`).join("\n");
  }

  function sidebarCandidates(text) {
    const wanted = normalize(text);
    const wantedCompact = wanted.replace(/[^A-Z0-9]/g, "");
    return deepElements()
      .filter(visible)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < Math.min(520, window.innerWidth * 0.32);
      })
      .map((element) => {
        const fullText = normalize([
          element.textContent,
          element.innerText,
          element.getAttribute?.("aria-label"),
          element.getAttribute?.("title"),
        ].filter(Boolean).join(" "));
        const fullCompact = fullText.replace(/[^A-Z0-9]/g, "");
        const exact = fullText === wanted || fullCompact === wantedCompact;
        // Jangan memakai startsWith pada teks tanpa pemisah. "BLOK III"
        // secara karakter memang diawali "BLOK II", sehingga menu Blok III
        // sebelumnya ikut dianggap sebagai kandidat Blok II.
        const starts = fullText.startsWith(`${wanted} `);
        return { element, exact, starts };
      })
      .filter((entry) => entry.exact || entry.starts)
      .sort((a, b) => {
        if (a.exact !== b.exact) return a.exact ? -1 : 1;
        const area = (entry) => entry.element.getBoundingClientRect().width * entry.element.getBoundingClientRect().height;
        return area(a) - area(b);
      })
      .map((entry) => entry.element);
  }

  function sidebarText(text) {
    return sidebarCandidates(text)[0] ?? null;
  }

  function sidebarSectionContainer(text) {
    const wanted = normalize(text);
    const wantedCompact = wanted.replace(/[^A-Z0-9]/g, "");
    const matches = sidebarCandidates(text)
      .flatMap((element) => {
        const ancestors = [];
        let current = element;
        for (let depth = 0; depth < 8 && current; depth += 1, current = current.parentElement) ancestors.push(current);
        return ancestors;
      })
      .filter((element, index, all) => all.indexOf(element) === index)
      .filter((element) => {
        if (!visible(element)) return false;
        const rect = element.getBoundingClientRect();
        if (rect.left >= Math.min(760, window.innerWidth * 0.32)
          || rect.width < 120 || rect.width > Math.min(900, window.innerWidth * 0.4)
          || rect.height < 36 || rect.height > 200) return false;
        const name = accessibleName(element);
        const compact = name.replace(/[^A-Z0-9]/g, "");
        return compact === wantedCompact || name.startsWith(`${wanted} `);
      })
      .sort((a, b) => {
        // Beberapa leluhur sidebar mencakup dua menu berurutan. Kandidat
        // terbesar dapat membuat titik klik jatuh pada Blok III walaupun teks
        // yang dicari adalah Blok II. Pilih leluhur terkecil yang masih
        // mencakup seluruh baris judul + subjudul.
        const area = (element) => element.getBoundingClientRect().width * element.getBoundingClientRect().height;
        return area(a) - area(b);
      });
    return matches[0] ?? null;
  }

  function dispatchClickOnElement(target) {
    if (!target || !visible(target)) return false;
    const rect = target.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + Math.min(rect.height / 2, 34);
    const init = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
    if (typeof PointerEvent === "function") {
      target.dispatchEvent(new PointerEvent("pointerdown", init));
      target.dispatchEvent(new PointerEvent("pointerup", init));
    }
    target.dispatchEvent(new MouseEvent("mousedown", init));
    target.dispatchEvent(new MouseEvent("mouseup", init));
    target.dispatchEvent(new MouseEvent("click", init));
    return true;
  }

  function clickSidebarText(text) {
    const compact = normalize(text).replace(/[^A-Z0-9]/g, "");
    if (compact === "SE2026LBLOKII") {
      const container = sidebarSectionContainer(text);
      if (container) {
        // React FASIH memasang aksi pada container baris tanpa role button.
        // Kirim event langsung ke baris tersebut agar event.target tidak
        // berubah menjadi menu tetangga akibat elementFromPoint/leluhur besar.
        return dispatchClickOnElement(container);
      }
    }
    const label = sidebarText(text);
    if (!label) return false;
    let target = label;
    for (let depth = 0; depth < 8 && target; depth += 1, target = target.parentElement) {
      if (target.matches?.("button,a,[role='button']")
        || target.tabIndex >= 0
        || getComputedStyle(target).cursor === "pointer") {
        const rect = target.getBoundingClientRect();
        return dispatchClickAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
      }
    }
    const rect = label.getBoundingClientRect();
    return dispatchClickAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function businessNameElements(businessName) {
    const wanted = normalize(businessName);
    const wantedCompact = wanted.replace(/[^A-Z0-9]/g, "");
    return deepElements()
      .filter((element) => {
        if (!visible(element)) return false;
        const value = normalize(element.textContent);
        return value === wanted || value.replace(/[^A-Z0-9]/g, "") === wantedCompact;
      })
      .sort((a, b) => {
        const area = (element) => element.getBoundingClientRect().width * element.getBoundingClientRect().height;
        return area(a) - area(b);
      });
  }

  function clickBusiness(businessName) {
    const names = businessNameElements(businessName);
    const buttons = [...document.querySelectorAll("button,a,[role='button']")]
      .filter((element) => visible(element) && normalize(element.textContent).includes("LIHAT RINCIAN"));
    if (names.length && buttons.length) {
      // Nama yang sama dapat muncul pada sidebar dan kartu utama. Pasangkan
      // tombol dengan nama yang pusat vertikalnya paling dekat pada layar.
      const pairs = [];
      for (const name of names) {
        const nameRect = name.getBoundingClientRect();
        const nameY = (nameRect.top + nameRect.bottom) / 2;
        for (const button of buttons) {
          const buttonRect = button.getBoundingClientRect();
          const buttonY = (buttonRect.top + buttonRect.bottom) / 2;
          const horizontalPenalty = buttonRect.left < nameRect.left ? 500 : 0;
          pairs.push({ button, score: Math.abs(buttonY - nameY) + horizontalPenalty });
        }
      }
      pairs.sort((a, b) => a.score - b.score);
      if (pairs[0] && pairs[0].score <= 180) {
        pairs[0].button.click();
        return true;
      }
    }

    // Cadangan untuk layout yang hanya menampilkan nama pada sidebar.
    const sidebarName = sidebarText(businessName);
    if (sidebarName && clickSidebarText(businessName)) return true;
    return false;
  }

  function businessReady(businessName) {
    return businessNameElements(businessName).some((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left < window.innerWidth * 0.86;
    });
  }

  function activeBusinessMatches(businessName) {
    if (!kbliQuestionLabel()) return false;
    const sidebarBoundary = Math.min(520, window.innerWidth * 0.32);
    return businessNameElements(businessName).some((element) => {
      const rect = element.getBoundingClientRect();
      // Nama di sidebar membuktikan usaha tersedia, tetapi bukan bahwa rincian
      // usaha tersebut sedang aktif. Nama pada area utama/footer berada di
      // sebelah kanan batas sidebar dan menjadi identitas rincian yang dibaca.
      return rect.left >= sidebarBoundary && rect.right <= window.innerWidth;
    });
  }

  async function openBusinessList(businessName) {
    if (businessReady(businessName)) return;
    showPageNotice("Menunggu menu SE2026 - L BLOK II siap…");

    // Route /edit muncul lebih dahulu daripada isi halaman. Jangan mencari
    // atau mengeklik menu sebelum sidebar benar-benar selesai dirender.
    await waitFor(
      () => sidebarSectionContainer("SE2026 - L BLOK II") || sidebarText("SE2026 - L BLOK II"),
      "Menu SE2026 - L BLOK II",
      90000,
    );
    showPageNotice("Membuka daftar usaha pada SE2026 - L BLOK II…");

    // Satu klik terverifikasi saja. FASIH kadang menampilkan layar loading
    // selama beberapa detik; klik kedua dapat membatalkan/mengulang navigasi.
    if (!clickSidebarText("SE2026 - L BLOK II")) {
      throw new Error("Menu SE2026 - L BLOK II tidak ditemukan.");
    }
    showPageNotice("Klik Blok II dikirim. Menunggu daftar usaha selesai dimuat…");
    await waitFor(
      () => businessReady(businessName),
      `Usaha ${businessName} setelah Blok II selesai dimuat`,
      90000,
    );
    showPageNotice("Blok II terbuka. Membuka usaha yang dipilih…");
  }

  async function openBusiness(payload) {
    if (activeBusinessMatches(payload.businessName)) return;
    await openBusinessList(payload.businessName);
    showPageNotice(`Memilih usaha yang tepat: ${payload.businessName}…`);
    if (!clickBusiness(payload.businessName)) throw new Error(`Nama/tombol usaha ${payload.businessName} tidak ditemukan.`);
    await waitFor(
      () => activeBusinessMatches(payload.businessName),
      `Rincian usaha aktif ${payload.businessName}`,
      90000,
    );
  }

  async function fill(payload, resumeAction = "fill") {
    await ensureEditMode(resumeAction, payload);
    await openBusiness(payload);
    const initialFields = locateFields();
    const missing = Object.entries(initialFields)
      .filter(([key, item]) => !item.input && !optionalFieldKeys.has(key))
      .map(([key]) => key);
    if (missing.length) throw new Error(`Field tidak ditemukan: ${missing.join(", ")}`);
    const skipped = Object.entries(initialFields)
      .filter(([key, item]) => !item.input && optionalFieldKeys.has(key))
      .map(([key]) => key);
    const changed = [];
    for (const key of Object.keys(fieldMap)) {
      const currentFields = locateFields();
      if (!currentFields[key].input) continue;
      const input = currentFields[key].input;
      const annualValue = digits(payload.values[key]);
      const monthly = isMonthlyBranch(currentFields[key]);
      const expected = digits(payload.values[key], monthly ? 12 : 1);
      const current = digits(input.value);
      if (current !== expected) {
        await setVerifiedFieldValue(key, expected);
        changed.push({
          key,
          expected,
          message: monthly
            ? `${key}: ${current} → ${expected} (${annualValue} ÷ 12)`
            : `${key}: ${current} → ${expected}`,
        });
      }
    }
    const fields = await verifyChangedFields(changed);
    window.scrollTo({ top: fields.q26a.label.getBoundingClientRect().top + window.scrollY - 140, behavior: "smooth" });
    const keys = changed.map((entry) => entry.key);
    if (keys.length) {
      sessionStorage.setItem("fasih-dom-assistant:last-change", JSON.stringify({
        path: location.pathname,
        businessName: payload.businessName,
        keys,
        savedAt: Date.now(),
      }));
    }
    return {
      fields,
      keys,
      message: changed.length
        ? `Terisi ${changed.length} field${skipped.length ? `; ${skipped.join(", ")} tidak tersedia dan dilewati` : ""}. Periksa field berbingkai oranye.\n${changed.map((entry) => entry.message).join("\n")}`
        : `Semua nilai yang tersedia sudah sama. Tidak ada field yang diubah${skipped.length ? `; ${skipped.join(", ")} tidak tersedia dan dilewati` : ""}.`,
    };
  }

  async function fillKbliRemark(payload) {
    const remark = String(payload.remark || "#1");
    const keepExisting = payload?.keepExistingKbli === true || remark === "#0";
    const targetCode = String(payload?.targetCode ?? "");
    if (!keepExisting && !/^\d{5}$/.test(targetCode)) throw new Error("Kode KBLI target harus terdiri dari 5 digit.");
    await ensureEditMode("fillRemark", payload);
    await openBusiness(payload);
    let item;
    if (keepExisting) {
      showPageNotice("Menambahkan remark #0 pada rincian 13.g tanpa mengubah KBLI…");
      item = await waitFor(currentKbliRemarkItem, "Rincian 13.g", 30000);
    } else {
      showPageNotice(`Memilih KBLI ${targetCode} pada rincian 13.g…`);
      item = await chooseKbli(targetCode);
      if (item.verifiedCode !== targetCode) {
        throw new Error(`Pemilihan KBLI ${targetCode} belum terkonfirmasi.`);
      }
    }
    const remarkResult = await addRemark("13.g", item, remark);
    await settle(2500);
    // Jangan memindai ulang dropdown sebelum Kirim. Pada FASIH panel dapat
    // tetap terbuka dan DOM-nya selalu memuat 01193 sebagai opsi pertama,
    // walaupun kotak utama sudah menampilkan target yang benar. Verifikasi
    // penyimpanan yang sesungguhnya dilakukan sesudah Kirim/halaman dimuat
    // ulang oleh verifyPersistedKbli().
    openSubmitSummary();
    await submitFinal();
    return keepExisting
      ? `KBLI tidak diubah, remark #0 ${remarkResult}, dan proses review dilanjutkan.`
      : `KBLI ${targetCode} dipilih, remark ${remark} ${remarkResult}, dan proses review dilanjutkan.`;
  }

  async function fillRemark(payload) {
    if (payload?.kind === "kbli") return fillKbliRemark(payload);
    const result = await fill(payload, "fillRemark");
    // Paket perubahan (#1-#4) harus selalu mengikuti perubahan DOM yang
    // terverifikasi pada proses saat ini. Abaikan remarkKeys dari paket lama agar remark tidak
    // dapat ditambahkan ketika tidak ada nilai yang benar-benar berubah.
    const explicitKeys = payload.mode !== "changed" && Array.isArray(payload.remarkKeys)
      ? payload.remarkKeys.filter((key) => fieldMap[key] && result.fields[key]?.input)
      : [];
    let keys = explicitKeys.length ? explicitKeys : result.keys;
    if (!keys.length && payload.mode !== "changed") {
      try {
        const previous = JSON.parse(sessionStorage.getItem("fasih-dom-assistant:last-change") ?? "null");
        if (previous?.path === location.pathname && previous?.businessName === payload.businessName && Date.now() - previous.savedAt < 30 * 60 * 1000) {
          keys = previous.keys.filter((key) => fieldMap[key] && result.fields[key]?.input);
        }
      } catch {
        // Abaikan catatan sesi yang rusak.
      }
    }
    const remark = String(payload.remark || "#1");
    if (!keys.length) {
      const message = payload.mode === "changed"
        ? `Tidak ada nilai FASIH yang berubah. Remark ${remark} tidak ditambahkan dan assignment tidak dikirim.`
        : "Tidak ada field berubah pada proses ini. Remark tidak ditambahkan dan Kirim tidak dibuka.";
      throw new Error(message);
    }
    const remarks = [];
    for (const key of keys) {
      const latestItem = locateFields()[key];
      if (!latestItem?.input) throw new Error(`Field ${key} hilang sebelum remark ditambahkan.`);
      remarks.push(`${key}: ${await addRemark(key, latestItem, remark)}`);
    }
    if (payload.mode === "changed") {
      const expected = keys.map((key) => ({
        key,
        expected: digits(payload.values[key], isMonthlyBranch(locateFields()[key]) ? 12 : 1),
      }));
      // FASIH menyimpan perubahan input secara asynchronous. Beri waktu agar
      // request penyimpanan selesai sebelum Ringkasan/Kirim membaca state.
      await verifyChangedFields(expected, 3500);
    }
    openSubmitSummary();
    await submitFinal();
    return `Remark selesai pada ${keys.length} field, Kirim final sudah diklik, dan proses review dilanjutkan.\n${remarks.join("\n")}`;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.action === "probe") {
      sendResponse({ ok: true, version: contentVersion });
      return false;
    }
    if (message?.action === "scan") {
      sendResponse({ ok: true, message: scanMessage() });
      return false;
    }
    if (message?.action === "fill") {
      fill(message.payload, "fill")
        .then((result) => sendResponse({ ok: true, message: result.message }))
        .catch((error) => sendResponse({ ok: false, message: error.message }));
      return true;
    }
    if (message?.action === "fillRemark") {
      fillRemark(message.payload)
        .then((result) => sendResponse({ ok: true, message: result }))
        .catch((error) => sendResponse({ ok: false, message: error.message }));
      return true;
    }
    return false;
  });

  async function resumeAfterEditNavigation() {
    let pending;
    try {
      pending = JSON.parse(sessionStorage.getItem(pendingKey) ?? "null");
    } catch {
      clearPending();
      return;
    }
    if (!pending || Date.now() - Number(pending.savedAt ?? 0) > 30 * 60 * 1000) {
      clearPending();
      return;
    }
    try {
      if (!isEditMode()) await openEditModeOrRevoke(pending.action, pending.payload);
      clearPending();
      showPageNotice("Mode edit aktif. Melanjutkan pengisian…");
      const message = pending.action === "fillRemark"
        ? await fillRemark(pending.payload)
        : (await fill(pending.payload, "fill")).message;
      showPageNotice(message, "success");
    } catch (error) {
      clearPending();
      showPageNotice(`Gagal melanjutkan: ${error.message}`, "error");
      await reportAutomationResult(activeAutoJobId(), false, error.message, automationFailureDetails(error));
    }
  }

  async function resumeAfterReviewNavigation() {
    let pending;
    try {
      pending = JSON.parse(sessionStorage.getItem(pendingReviewKey) ?? "null");
    } catch {
      sessionStorage.removeItem(pendingReviewKey);
      return;
    }
    if (!pending || Date.now() - Number(pending.savedAt ?? 0) > 30 * 60 * 1000) {
      sessionStorage.removeItem(pendingReviewKey);
      return;
    }
    try {
      showPageNotice("Menunggu halaman review siap…");
      const job = activeAutoJob();
      if (!job?.payload) throw new Error("Paket proses aktif tidak ditemukan untuk verifikasi nilai tersimpan.");
      await verifyPersistedValues(job.payload);
      const checkButton = await waitFor(findReviewCheckButton, "Tombol centang review", 60000);
      sessionStorage.removeItem(pendingReviewKey);
      showPageNotice("Nilai tersimpan sudah sesuai. Mengklik tombol centang review…", "success");
      checkButton.click();
      const dialog = await waitFor(approvalDialog, "Dialog Approve Assignment", 30000);
      const confirmButton = [...dialog.querySelectorAll("button,[role='button']")]
        .find((button) => visible(button) && normalize(button.textContent) === "KONFIRMASI");
      if (!confirmButton) throw new Error("Tombol Konfirmasi approval tidak ditemukan.");
      sessionStorage.setItem(pendingApprovalKey, JSON.stringify({
        savedAt: Date.now(),
        jobId: pending.jobId || activeAutoJobId(),
        persistedValuesVerified: true,
      }));
      showPageNotice("Mengonfirmasi approval assignment…");
      confirmButton.click();
      await waitFor(() => !visible(dialog), "Penyelesaian approval", 30000);
      sessionStorage.removeItem(pendingApprovalKey);
      const message = "Assignment berhasil dikirim, kembali ke review, dan dikonfirmasi.";
      showPageNotice(message, "success");
      await reportAutomationResult(pending.jobId || activeAutoJobId(), true, message);
    } catch (error) {
      sessionStorage.removeItem(pendingReviewKey);
      if (restartAfterPersistenceMismatch(error)) return;
      showPageNotice(`Gagal melanjutkan review: ${error.message}`, "error");
      await reportAutomationResult(pending?.jobId || activeAutoJobId(), false, error.message);
    }
  }

  async function resumeAfterApprovalNavigation() {
    let pending;
    try {
      pending = JSON.parse(sessionStorage.getItem(pendingApprovalKey) ?? "null");
    } catch {
      sessionStorage.removeItem(pendingApprovalKey);
      return;
    }
    if (!pending || Date.now() - Number(pending.savedAt ?? 0) > 30 * 60 * 1000) {
      sessionStorage.removeItem(pendingApprovalKey);
      return;
    }
    try {
      if (pending.persistedValuesVerified !== true) {
        throw new Error("Approval tidak dilanjutkan karena nilai tersimpan belum terverifikasi.");
      }
      const dialog = approvalDialog();
      if (dialog) await waitFor(() => !visible(dialog), "Penyelesaian approval", 30000);
      sessionStorage.removeItem(pendingApprovalKey);
      const message = "Assignment berhasil dikirim, kembali ke review, dan dikonfirmasi.";
      showPageNotice(message, "success");
      await reportAutomationResult(pending.jobId || activeAutoJobId(), true, message);
    } catch (error) {
      sessionStorage.removeItem(pendingApprovalKey);
      showPageNotice(`Gagal memastikan approval: ${error.message}`, "error");
      await reportAutomationResult(pending.jobId || activeAutoJobId(), false, error.message);
    }
  }

  function assignmentPath(value) {
    try {
      return new URL(value, location.href).pathname.replace(/\/edit\/?$/i, "").replace(/\/$/, "");
    } catch {
      return "";
    }
  }

  async function claimPendingAutomation() {
    let job;
    try {
      job = JSON.parse(sessionStorage.getItem(pendingUrlJobKey) ?? "null");
    } catch {
      sessionStorage.removeItem(pendingUrlJobKey);
      return null;
    }
    if (!job || Date.now() - Number(job.createdAt ?? 0) >= 30 * 60 * 1000
      || assignmentPath(job.payload?.fasihLink) !== assignmentPath(location.href)) {
      sessionStorage.removeItem(pendingUrlJobKey);
      return null;
    }
    sessionStorage.removeItem(pendingUrlJobKey);
    sessionStorage.setItem(activeAutoJobKey, JSON.stringify(job));
    return job;
  }

  async function runPendingAutomation() {
    if (sessionStorage.getItem(pendingKey)
      || sessionStorage.getItem(pendingReviewKey)
      || sessionStorage.getItem(pendingApprovalKey)) return;
    const job = await claimPendingAutomation();
    if (!job) return;
    const processStatus = ["#0", "#1", "#2", "#3", "#4"].includes(job.payload?.suggestedStatus)
      ? job.payload.suggestedStatus
      : (job.payload?.remark || "otomatis");
    try {
      showPageNotice(`Paket ${processStatus} diterima. Menjalankan pengisian FASIH otomatis…`);
      const message = await fillRemark(job.payload);
      // Tahap review diselesaikan oleh resumeAfterReviewNavigation, termasuk
      // setelah navigasi halaman. Jangan laporkan berhasil lebih awal.
      if (!sessionStorage.getItem(pendingReviewKey)) {
        await reportAutomationResult(job.requestId, true, message);
        showPageNotice(message, "success");
      }
    } catch (error) {
      showPageNotice(`Proses ${processStatus} gagal: ${error.message}`, "error");
      await reportAutomationResult(job.requestId, false, error.message, automationFailureDetails(error));
    }
  }

  setTimeout(resumeAfterEditNavigation, 350);
  setTimeout(resumeAfterReviewNavigation, 450);
  setTimeout(resumeAfterApprovalNavigation, 550);
  setTimeout(runPendingAutomation, 700);
  setInterval(() => {
    restartStalledAutomation().catch((error) => {
      recoveryInProgress = false;
      showPageNotice(`Pemulihan otomatis gagal: ${error.message}`, "error");
    });
  }, 5000);
})();

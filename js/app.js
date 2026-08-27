(() => {
  "use strict";

  // ---------- element refs ----------
  const upiIdEl      = document.getElementById("upiId");
  const upiHintEl     = document.getElementById("upiHint");
  const payeeNameEl  = document.getElementById("payeeName");
  const amountEl     = document.getElementById("amount");
  const noteEl       = document.getElementById("note");
  const cardTitleEl  = document.getElementById("cardTitle");
  const generateBtn  = document.getElementById("generateBtn");
  const errorMsgEl   = document.getElementById("errorMsg");

  const holoCard      = document.getElementById("holoCard");
  const cardTitleOut  = document.getElementById("cardTitleOut");
  const cardSubOut    = document.getElementById("cardSubOut");
  const amtPill       = document.getElementById("amtPill");
  const qrCanvas      = document.getElementById("qrCanvas");
  const qrPlaceholder = document.getElementById("qrPlaceholder");
  const centerCharm   = document.getElementById("centerCharm");

  const downloadBtn  = document.getElementById("downloadBtn");
  const copyLinkBtn  = document.getElementById("copyLinkBtn");
  const amountToggle = document.querySelectorAll(".toggle-btn");
  const themeRow     = document.getElementById("themeRow");
  const themeCharms  = { healing: "✦", chrome: "❄", mint: "﹡", candy: "♡" };

  let amountMode = "open"; // 'open' | 'fixed'
  let activeTheme = "healing";
  let currentUpiLink = "";

  // ---------- amount mode toggle ----------
  amountToggle.forEach(btn => {
    btn.addEventListener("click", () => {
      amountToggle.forEach(b => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      amountMode = btn.dataset.mode;
      amountEl.classList.toggle("is-hidden", amountMode !== "fixed");
      if (amountMode !== "fixed") amountEl.value = "";
    });
  });

  // ---------- theme swatches ----------
  function setActiveTheme(theme){
    activeTheme = theme;
    holoCard.dataset.theme = theme;
    centerCharm.textContent = themeCharms[theme] || "✦";
    document.querySelectorAll(".sticker-swatch").forEach(sw => {
      sw.classList.toggle("is-active", sw.dataset.theme === theme);
    });
  }
  themeRow.addEventListener("click", (e) => {
    const btn = e.target.closest(".sticker-swatch");
    if (!btn) return;
    setActiveTheme(btn.dataset.theme);
    if (currentUpiLink) renderQR(currentUpiLink); // re-render so download matches new skin
  });
  setActiveTheme("healing");

  // ---------- helpers ----------
  // Accepts any real-world VPA: numeric or alpha prefixes, dots/hyphens/underscores,
  // and bank/PSP handles of varying length (ybl, paytm, okhdfcbank, ptaxis, ibl, etc.)
  const VPA_RE = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9.\-]{1,64}$/;

  function showError(msg){
    errorMsgEl.textContent = msg || "";
  }

  // Keep the payload as short as possible — every extra character adds modules
  // to the QR, which is what makes a code slow for a phone camera to lock onto.
  // Manual percent-encoding (not URLSearchParams) so spaces become %20, not "+",
  // since some apps parse the upi:// URI literally and mangle "+" as a space.
  function buildUpiLink({ vpa, name, amount, note }){
    const parts = [];
    const add = (key, val) => parts.push(`${key}=${encodeURIComponent(val)}`);

    add("pa", vpa);
    add("pn", name);
    if (amount) add("am", amount);
    if (note) add("tn", note);
    add("cu", "INR");

    return `upi://pay?${parts.join("&")}`;
  }

  function renderQR(link){
    // Real QR stays plain black-on-white for maximum scanner compatibility,
    // regardless of card skin — only the frame around it is themed.
    if (typeof QRCode === "undefined" || !QRCode.toCanvas) {
      showError("QR library failed to load — check your internet connection and reload the page.");
      return;
    }
    QRCode.toCanvas(qrCanvas, link, {
      width: 280,
      margin: 4,                    // proper quiet zone so cameras lock on fast
      errorCorrectionLevel: "L",    // shortest payload → lowest error correction it actually needs → faster scan
      color: { dark: "#0b0b10", light: "#f8f6f2" }
    }, (err) => {
      if (err) {
        console.error("QR render error:", err);
        showError("Couldn't render the QR — try again.");
        return;
      }
      qrCanvas.style.display = "block";
      qrPlaceholder.style.display = "none";
      downloadBtn.disabled = false;
      copyLinkBtn.disabled = false;
    });
  }

  // ---------- generate ----------
  generateBtn.addEventListener("click", () => {
    showError("");

    const vpa   = upiIdEl.value.trim();
    const name  = (payeeNameEl.value.trim() || "Custom-Pay user").slice(0, 40);
    const note  = noteEl.value.trim().slice(0, 50);
    const title = (cardTitleEl.value.trim() || "SCAN TO PAY").toUpperCase().slice(0, 24);

    if (!vpa) {
      showError("Enter a UPI ID to continue.");
      upiIdEl.focus();
      return;
    }
    if (!VPA_RE.test(vpa)) {
      showError("That doesn't look like a valid UPI ID — try name@bank.");
      upiIdEl.focus();
      return;
    }

    if (typeof QRCode === "undefined" || !QRCode.toCanvas) {
      showError("QR library hasn't finished loading yet — wait a second and click Generate again.");
      return;
    }

    let amount = "";
    if (amountMode === "fixed") {
      const raw = amountEl.value.trim();
      const num = Number(raw);
      if (!raw || !Number.isFinite(num) || num <= 0) {
        showError("Enter a valid fixed amount, or switch to Any amount.");
        amountEl.focus();
        return;
      }
      amount = num.toFixed(2);
    }

    const link = buildUpiLink({ vpa, name, amount, note });
    currentUpiLink = link;

    // update card text
    cardTitleOut.textContent = title;
    cardSubOut.textContent = name;
    amtPill.textContent = amount ? `₹${Number(amount).toLocaleString("en-IN")}` : "Open amount";

    renderQR(link);
  });

  // ---------- download ----------
  downloadBtn.addEventListener("click", async () => {
    downloadBtn.disabled = true;
    const original = downloadBtn.textContent;
    downloadBtn.textContent = "Rendering…";
    try {
      const canvas = await html2canvas(holoCard, {
        backgroundColor: null,
        scale: 3,
        useCORS: true
      });
      const link = document.createElement("a");
      const safeName = (payeeNameEl.value.trim() || "custom-pay").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      link.download = `${safeName}-qr-${activeTheme}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch (e) {
      showError("Download failed — your browser may be blocking canvas export.");
    } finally {
      downloadBtn.disabled = false;
      downloadBtn.textContent = original;
    }
  });

  // ---------- copy link ----------
  copyLinkBtn.addEventListener("click", async () => {
    if (!currentUpiLink) return;
    try {
      await navigator.clipboard.writeText(currentUpiLink);
      const original = copyLinkBtn.textContent;
      copyLinkBtn.textContent = "Copied!";
      setTimeout(() => (copyLinkBtn.textContent = original), 1400);
    } catch {
      showError("Couldn't copy — select and copy the link manually.");
    }
  });

  // ---------- light input polish ----------
  upiIdEl.addEventListener("input", () => {
    upiHintEl.classList.remove("is-error");
    upiHintEl.textContent = "e.g. healingchoi@okicici";
  });
})();

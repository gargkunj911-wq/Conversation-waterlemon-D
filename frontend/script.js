// ---------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------
const API_BASE = ""; // same-origin, since main.py serves this frontend.
// If you run the frontend on a separate dev server, set this to e.g.
// "http://localhost:8000" instead.

// ---------------------------------------------------------------------
// Element refs
// ---------------------------------------------------------------------
const inputView = document.getElementById("inputView");
const loadingView = document.getElementById("loadingView");
const resultsView = document.getElementById("resultsView");

const uploadDrop = document.getElementById("uploadDrop");
const pdfFileInput = document.getElementById("pdfFile");
const uploadText = document.getElementById("uploadText");
const pasteText = document.getElementById("pasteText");
const modeToggle = document.getElementById("modeToggle");
const modeButtons = modeToggle.querySelectorAll(".mode-btn");

const generateBtn = document.getElementById("generateBtn");
const errorMessage = document.getElementById("errorMessage");
const loadingText = document.getElementById("loadingText");

const modelOptions = document.querySelectorAll(".model-option");
const dailyReportsList = document.getElementById("dailyReportsList");
const weeklyCard = document.getElementById("weeklyCard");
const weeklyReportContent = document.getElementById("weeklyReportContent");
const newReportBtn = document.getElementById("newReportBtn");
const streamStatus = document.getElementById("streamStatus");
const streamStatusText = document.getElementById("streamStatusText");

let selectedFile = null;
let inputMode = "pdf"; // "pdf" | "text"

// ---------------------------------------------------------------------
// Mode toggle (Upload PDF vs Paste Text)
// ---------------------------------------------------------------------
modeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    inputMode = btn.dataset.mode;
    modeButtons.forEach((b) => b.classList.toggle("active", b === btn));

    if (inputMode === "pdf") {
      uploadDrop.hidden = false;
      pasteText.hidden = true;
      generateBtn.disabled = !selectedFile;
    } else {
      uploadDrop.hidden = true;
      pasteText.hidden = false;
      generateBtn.disabled = !pasteText.value.trim();
    }
    clearError();
  });
});

pasteText.addEventListener("input", () => {
  if (inputMode === "text") {
    generateBtn.disabled = !pasteText.value.trim();
  }
});

// ---------------------------------------------------------------------
// Model radio styling (JS fallback for browsers without :has())
// ---------------------------------------------------------------------
modelOptions.forEach((opt) => {
  const radio = opt.querySelector("input[type='radio']");
  radio.addEventListener("change", () => {
    modelOptions.forEach((o) => o.classList.remove("selected"));
    opt.classList.add("selected");
  });
});

// ---------------------------------------------------------------------
// File upload (click + drag/drop)
// ---------------------------------------------------------------------
pdfFileInput.addEventListener("change", () => {
  if (pdfFileInput.files.length) {
    handleFileSelected(pdfFileInput.files[0]);
  }
});

["dragenter", "dragover"].forEach((evt) => {
  uploadDrop.addEventListener(evt, (e) => {
    e.preventDefault();
    uploadDrop.classList.add("drag-over");
  });
});

["dragleave", "drop"].forEach((evt) => {
  uploadDrop.addEventListener(evt, (e) => {
    e.preventDefault();
    uploadDrop.classList.remove("drag-over");
  });
});

uploadDrop.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  if (file) handleFileSelected(file);
});

function handleFileSelected(file) {
  if (file.type !== "application/pdf") {
    showError("Please upload a PDF file.");
    return;
  }
  selectedFile = file;
  uploadText.textContent = file.name;
  uploadDrop.classList.add("has-file");
  generateBtn.disabled = false;
  clearError();
}

// ---------------------------------------------------------------------
// Generate report
// ---------------------------------------------------------------------
generateBtn.addEventListener("click", async () => {
  if (inputMode === "pdf" && !selectedFile) return;
  if (inputMode === "text" && !pasteText.value.trim()) return;
  clearError();

  const model = document.querySelector("input[name='model']:checked").value;

  const formData = new FormData();
  formData.append("model", model);
  if (inputMode === "pdf") {
    formData.append("file", selectedFile);
  } else {
    formData.append("text", pasteText.value.trim());
  }

  // Reset results view for a fresh run
  dailyReportsList.innerHTML = "";
  weeklyReportContent.innerHTML = "";
  weeklyCard.hidden = true;

  showView(loadingView);
  setLoadingText(
    inputMode === "pdf" ? "Extracting conversation from the PDF…" : "Preparing conversation…"
  );

  try {
    const response = await fetch(`${API_BASE}/generate-report/stream`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(errBody.detail || `Request failed (${response.status})`);
    }

    // Switch to the results view now — daily cards will fill in live.
    showView(resultsView);
    setStreamStatus(
      model === "gemini"
        ? "Generating Day 1 with Gemini…"
        : "Generating Day 1 with Qwen…"
    );

    await consumeStream(response.body);

    hideStreamStatus();
  } catch (err) {
    showView(inputView);
    showError(err.message || "Something went wrong. Please try again.");
  }
});

function setLoadingText(text) {
  loadingText.textContent = text;
}

// ---------------------------------------------------------------------
// Stream consumption (NDJSON: one JSON object per line)
// ---------------------------------------------------------------------
async function consumeStream(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dayCount = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop(); // keep the last (possibly incomplete) line

    for (const line of lines) {
      if (!line.trim()) continue;
      const chunk = JSON.parse(line);

      if (chunk.type === "daily") {
        dayCount += 1;
        appendDailyCard(dayCount, chunk.content);
        setStreamStatus(`Day ${dayCount} ready — generating Day ${dayCount + 1}…`);
      } else if (chunk.type === "weekly") {
        renderWeekly(chunk.content);
      } else if (chunk.type === "error") {
        throw new Error(chunk.message || "Report generation failed.");
      }
    }
  }

  // Flush any trailing line without a newline at the very end
  if (buffer.trim()) {
    const chunk = JSON.parse(buffer);
    if (chunk.type === "daily") {
      dayCount += 1;
      appendDailyCard(dayCount, chunk.content);
    } else if (chunk.type === "weekly") {
      renderWeekly(chunk.content);
    } else if (chunk.type === "error") {
      throw new Error(chunk.message || "Report generation failed.");
    }
  }
}

// ---------------------------------------------------------------------
// Render one daily card as soon as it arrives
// ---------------------------------------------------------------------
function appendDailyCard(dayCount, reportText) {
  const card = document.createElement("div");
  card.className = "daily-card streaming-in";

  const dayLabel = extractDayLabel(reportText) || `Day ${dayCount}`;

  card.innerHTML = `
    <button class="daily-card-toggle" type="button">
      <span>${escapeHtml(dayLabel)}</span>
      <span class="daily-card-chevron">▾</span>
    </button>
    <div class="daily-card-body">
      <div class="report-content">${markdownToHtml(reportText)}</div>
    </div>
  `;

  card.querySelector(".daily-card-toggle").addEventListener("click", () => {
    card.classList.toggle("open");
  });

  // Open the newest card by default, collapse the previous one
  dailyReportsList.querySelectorAll(".daily-card.open").forEach((el) => el.classList.remove("open"));
  card.classList.add("open");

  dailyReportsList.appendChild(card);
}

function renderWeekly(weeklyText) {
  weeklyReportContent.innerHTML = markdownToHtml(weeklyText);
  weeklyCard.hidden = false;
}

function setStreamStatus(text) {
  streamStatusText.textContent = text;
  streamStatus.hidden = false;
}

function hideStreamStatus() {
  streamStatus.hidden = true;
}

function extractDayLabel(text) {
  const match = text.match(/Day\s+\d+/i);
  return match ? match[0] : null;
}

// ---------------------------------------------------------------------
// Minimal markdown-style renderer (headings, bullets, bold, paragraphs)
// ---------------------------------------------------------------------
function markdownToHtml(text) {
  if (!text) return "";

  const escaped = escapeHtml(text);
  const lines = escaped.split("\n");

  let html = "";
  let inList = false;

  for (let rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      if (inList) { html += "</ul>"; inList = false; }
      continue;
    }

    if (/^#{1,3}\s+/.test(line)) {
      if (inList) { html += "</ul>"; inList = false; }
      const level = line.match(/^#+/)[0].length;
      const content = line.replace(/^#{1,3}\s+/, "");
      html += `<h${level}>${inlineFormat(content)}</h${level}>`;
      continue;
    }

    if (/^[-*•]\s+/.test(line)) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${inlineFormat(line.replace(/^[-*•]\s+/, ""))}</li>`;
      continue;
    }

    // Treat a short standalone line ending in ":" as a subheading
    if (/^[A-Za-z ]{3,40}:$/.test(line)) {
      if (inList) { html += "</ul>"; inList = false; }
      html += `<h3>${inlineFormat(line)}</h3>`;
      continue;
    }

    if (inList) { html += "</ul>"; inList = false; }
    html += `<p>${inlineFormat(line)}</p>`;
  }

  if (inList) html += "</ul>";
  return html;
}

function inlineFormat(str) {
  return str.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------------------------------------------------------------------
// View switching
// ---------------------------------------------------------------------
function showView(view) {
  [inputView, loadingView, resultsView].forEach((v) => (v.hidden = true));
  view.hidden = false;
}

newReportBtn.addEventListener("click", () => {
  selectedFile = null;
  pdfFileInput.value = "";
  pasteText.value = "";
  uploadText.textContent = "Click to choose a PDF, or drag it here";
  uploadDrop.classList.remove("has-file");
  generateBtn.disabled = true;
  clearError();
  dailyReportsList.innerHTML = "";
  weeklyReportContent.innerHTML = "";
  weeklyCard.hidden = true;
  hideStreamStatus();
  showView(inputView);
});

// ---------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------
function showError(msg) {
  errorMessage.textContent = msg;
  errorMessage.hidden = false;
}

function clearError() {
  errorMessage.hidden = true;
  errorMessage.textContent = "";
}

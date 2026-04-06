/**
 * QRok — app.js
 * Scan page controller.
 * Orchestrates tabs, camera, upload, paste, and navigates to result.
 */

import { parseQRContent } from './parser.js';
import { analyzeRisk }    from './risk-engine.js';
import { addHistoryEntry } from './history.js';
import { fileToDataUrl }  from './utils.js';
import {
  startCameraScanning,
  stopCameraScanning,
  getCameraDevices,
  decodeQRFromFile,
} from './scanner.js';

// Only run on scan.html
if (document.body.classList.contains('page-scan')) {
  initScanPage();
}

function initScanPage() {
  // ---- Tab switching -----------------------------------------------
  const tabs     = document.querySelectorAll('.tab-btn');
  const panels   = document.querySelectorAll('.tab-panel');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      if (tab.dataset.tab === currentTab) return;

      // Stop camera when leaving camera tab
      if (currentTab === 'camera') {
        stopCamera();
      }

      currentTab = tab.dataset.tab;
      tabs.forEach(t   => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${currentTab}`).classList.add('active');
    });
  });

  let currentTab = 'camera';

  // ---- Camera tab -------------------------------------------------
  const videoEl        = document.getElementById('cameraVideo');
  const canvasEl       = document.getElementById('cameraCanvas');
  const startBtn       = document.getElementById('startCamera');
  const stopBtn        = document.getElementById('stopCamera');
  const cameraSelect   = document.getElementById('cameraSelect');
  const cameraStatus   = document.getElementById('cameraStatus');
  const cameraPlaceholder = document.getElementById('cameraPlaceholder');
  const scanLine       = document.getElementById('scanLine');

  let cameraActive = false;
  let lastScannedRaw = null;
  let navigating = false;

  startBtn.addEventListener('click', startCamera);
  stopBtn.addEventListener('click', stopCamera);
  cameraSelect.addEventListener('change', async () => {
    if (cameraActive) {
      await stopCamera();
      await startCamera();
    }
  });

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStatus('Camera API not supported in this browser.', 'error');
      return;
    }

    setCameraStatus('Requesting camera access…');
    startBtn.disabled = true;

    try {
      await startCameraScanning(
        videoEl,
        canvasEl,
        cameraSelect.value || undefined,
        onQRDetected,
        (err) => {
          setCameraStatus(err.message, 'error');
          cameraActive = false;
          startBtn.style.display = '';
          stopBtn.style.display  = 'none';
          startBtn.disabled = false;
          cameraPlaceholder.style.display = 'flex';
          scanLine.classList.remove('active');
        }
      );

      cameraActive = true;
      startBtn.style.display  = 'none';
      stopBtn.style.display   = '';
      cameraPlaceholder.style.display = 'none';
      scanLine.classList.add('active');
      setCameraStatus('Scanning — point at a QR code');

      // Populate camera list after stream started (for permission)
      populateCameraList();

    } catch (err) {
      setCameraStatus(err.message, 'error');
      startBtn.disabled = false;
    }
  }

  async function stopCamera() {
    await stopCameraScanning();
    cameraActive = false;
    videoEl.srcObject = null;
    startBtn.style.display  = '';
    stopBtn.style.display   = 'none';
    startBtn.disabled       = false;
    cameraPlaceholder.style.display = 'flex';
    scanLine.classList.remove('active');
    setCameraStatus('');
  }

  async function populateCameraList() {
    const devices = await getCameraDevices();
    if (devices.length > 1) {
      cameraSelect.innerHTML = devices.map(d =>
        `<option value="${d.deviceId}">${d.label || `Camera ${devices.indexOf(d) + 1}`}</option>`
      ).join('');
      cameraSelect.style.display = '';
    }
  }

  function setCameraStatus(msg, type = '') {
    cameraStatus.textContent = msg;
    cameraStatus.className   = 'camera-status' + (type ? ` ${type}` : '');
  }

  function onQRDetected(raw) {
    if (navigating) return;
    if (raw === lastScannedRaw) return;
    lastScannedRaw = raw;
    navigating = true;
    setCameraStatus('QR code detected — analyzing…');
    scanLine.classList.remove('active');
    navigateToResult(raw);
  }

  // ---- Upload tab -------------------------------------------------
  const uploadZone    = document.getElementById('uploadZone');
  const fileInput     = document.getElementById('fileInput');
  const uploadPreview = document.getElementById('uploadPreview');
  const previewImg    = document.getElementById('previewImg');
  const uploadInfo    = document.getElementById('uploadInfo');
  const uploadControls= document.getElementById('uploadControls');
  const analyzeBtn    = document.getElementById('analyzeUpload');
  const clearUploadBtn= document.getElementById('clearUpload');
  const uploadStatus  = document.getElementById('uploadStatus');

  let uploadedFile = null;

  uploadZone.addEventListener('click', () => fileInput.click());

  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
  });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFileSelect(fileInput.files[0]);
  });

  async function handleFileSelect(file) {
    if (!file.type.startsWith('image/')) {
      setUploadStatus('Please select an image file (PNG, JPG, GIF, BMP, WebP).', 'error');
      return;
    }

    const maxSize = 20 * 1024 * 1024;
    if (file.size > maxSize) {
      setUploadStatus('File is too large (max 20MB).', 'error');
      return;
    }

    uploadedFile = file;
    setUploadStatus('');

    try {
      const dataUrl = await fileToDataUrl(file);
      previewImg.src = dataUrl;
      uploadInfo.innerHTML = `
        <div>${escapeHtml(file.name)}</div>
        <div>${formatFileSize(file.size)} · ${file.type}</div>
      `;
      uploadPreview.style.display  = 'flex';
      uploadControls.style.display = 'flex';
      uploadZone.style.display     = 'none';
    } catch (err) {
      setUploadStatus('Failed to load image: ' + err.message, 'error');
    }
  }

  analyzeBtn.addEventListener('click', async () => {
    if (!uploadedFile) return;
    analyzeBtn.disabled = true;
    setUploadStatus('Decoding QR code…');

    try {
      const raw = await decodeQRFromFile(uploadedFile);
      setUploadStatus('QR found — analyzing…');
      navigateToResult(raw);
    } catch (err) {
      setUploadStatus(err.message, 'error');
      analyzeBtn.disabled = false;
    }
  });

  clearUploadBtn.addEventListener('click', () => {
    uploadedFile = null;
    fileInput.value = '';
    previewImg.src = '';
    uploadPreview.style.display  = 'none';
    uploadControls.style.display = 'none';
    uploadZone.style.display     = '';
    setUploadStatus('');
  });

  function setUploadStatus(msg, type = '') {
    uploadStatus.textContent = msg;
    uploadStatus.className   = 'status-msg' + (type ? ` ${type}` : '');
  }

  // ---- Paste tab --------------------------------------------------
  const pasteInput   = document.getElementById('pasteInput');
  const analyzeP     = document.getElementById('analyzePaste');
  const clearPasteBtn= document.getElementById('clearPaste');
  const pasteStatus  = document.getElementById('pasteStatus');

  analyzeP.addEventListener('click', () => {
    const val = pasteInput.value.trim();
    if (!val) {
      setPasteStatus('Please enter some content to analyze.', 'error');
      return;
    }
    navigateToResult(val);
  });

  pasteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      analyzeP.click();
    }
  });

  clearPasteBtn.addEventListener('click', () => {
    pasteInput.value = '';
    setPasteStatus('');
  });

  function setPasteStatus(msg, type = '') {
    pasteStatus.textContent = msg;
    pasteStatus.className   = 'status-msg' + (type ? ` ${type}` : '');
  }

  // ---- Navigation -------------------------------------------------
  function navigateToResult(raw) {
    const parsed = parseQRContent(raw);
    const risk   = analyzeRisk(parsed);
    const entry  = addHistoryEntry({ raw, parsed, risk });

    const payload = encodeURIComponent(JSON.stringify({
      id:     entry.id,
      raw:    raw,
      parsed: { type: parsed.type, label: parsed.label, data: parsed.data },
      risk:   {
        score:    risk.score,
        level:    risk.level,
        verdict:  risk.verdict,
        icon:     risk.icon,
        color:    risk.color,
        findings: risk.findings,
      },
      timestamp: entry.timestamp,
    }));

    // Use sessionStorage for larger payloads instead of URL params
    try {
      sessionStorage.setItem('qrok_result', decodeURIComponent(payload));
      window.location.href = 'result.html';
    } catch {
      // Fallback: direct URL (truncated if huge — result page also reads sessionStorage)
      window.location.href = 'result.html';
    }
  }
}

// ---- Shared helpers (available globally within module) ----------

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function formatFileSize(bytes) {
  if (bytes < 1024)       return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

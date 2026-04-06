/**
 * QRok — result.js
 * Result page controller.
 * Reads scan result from sessionStorage, renders the full analysis UI.
 */

import { addHistoryEntry, getHistoryEntry } from './history.js';
import { parseQRContent }  from './parser.js';
import { analyzeRisk }     from './risk-engine.js';
import { copyToClipboard, timeAgo, formatTimestamp, isValidUrl } from './utils.js';

function escapeHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

document.addEventListener('DOMContentLoaded', initResultPage);

function initResultPage() {
  const loadingEl  = document.getElementById('resultLoading');
  const errorEl    = document.getElementById('resultError');
  const contentEl  = document.getElementById('resultContent');
  const errorMsg   = document.getElementById('errorMessage');

  // Small delay for animation polish
  setTimeout(() => {
    const data = readResultData();
    if (!data) {
      loadingEl.style.display = 'none';
      errorEl.style.display   = 'flex';
      errorMsg.textContent    = 'No scan result found. Please scan a QR code first.';
      return;
    }

    try {
      render(data);
      loadingEl.style.display = 'none';
      contentEl.style.display = 'block';
    } catch (err) {
      loadingEl.style.display = 'none';
      errorEl.style.display   = 'flex';
      errorMsg.textContent    = 'Failed to render result: ' + err.message;
      console.error('QRok result render error:', err);
    }
  }, 300);
}

// ---- Read result data --------------------------------------------

function readResultData() {
  // Primary: sessionStorage (set by scan page)
  try {
    const raw = sessionStorage.getItem('qrok_result');
    if (raw) {
      const data = JSON.parse(raw);
      if (data && data.raw) return data;
    }
  } catch { /* ignore */ }

  // Fallback: URL search param
  try {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (id) {
      const entry = getHistoryEntry(id);
      if (entry) return rebuildFromEntry(entry);
    }
  } catch { /* ignore */ }

  return null;
}

function rebuildFromEntry(entry) {
  const parsed = parseQRContent(entry.raw);
  const risk   = analyzeRisk(parsed);
  return {
    id:        entry.id,
    raw:       entry.raw,
    parsed:    { type: parsed.type, label: parsed.label, data: parsed.data },
    risk:      { score: risk.score, level: risk.level, verdict: risk.verdict, icon: risk.icon, color: risk.color, findings: risk.findings },
    timestamp: entry.timestamp,
  };
}

// ---- Render -------------------------------------------------------

function render(data) {
  const { raw, parsed, risk, timestamp } = data;

  // Risk banner
  const banner = document.getElementById('riskBanner');
  banner.className = `risk-banner risk-${risk.color}`;
  document.getElementById('riskIcon').textContent   = risk.icon;
  document.getElementById('riskLabel').textContent  = risk.verdict;
  document.getElementById('riskLevel').textContent  = risk.level.toUpperCase();
  document.getElementById('riskScore').textContent  = risk.score;

  // Content type
  document.getElementById('contentTypeBadge').textContent = parsed.label || parsed.type;
  document.getElementById('scanMeta').textContent = timestamp
    ? `${timeAgo(timestamp)} · ${formatTimestamp(timestamp)}`
    : '';

  // Findings
  renderFindings(risk.findings);

  // Parsed data
  renderParsedData(parsed);

  // Raw content
  const rawEl = document.getElementById('rawContent');
  rawEl.textContent = raw;

  // Copy button
  const copyBtn = document.getElementById('copyRaw');
  copyBtn.addEventListener('click', async () => {
    const ok = await copyToClipboard(raw);
    copyBtn.textContent = ok ? '✓ Copied' : '✗ Failed';
    setTimeout(() => { copyBtn.textContent = '⧉ Copy'; }, 2000);
  });

  // Save to history button
  const saveBtn = document.getElementById('saveResult');
  saveBtn.addEventListener('click', () => {
    const parsedFull = parseQRContent(raw);
    const riskFull   = analyzeRisk(parsedFull);
    addHistoryEntry({ raw, parsed: parsedFull, risk: riskFull });
    saveBtn.textContent = '✓ Saved';
    saveBtn.disabled = true;
    setTimeout(() => {
      saveBtn.textContent = '◷ Save to History';
      saveBtn.disabled = false;
    }, 2000);
  });

  // Open link button (URLs only)
  if (parsed.type === 'url' && parsed.data.url) {
    const openBtn = document.getElementById('openLink');
    openBtn.style.display = '';
    openBtn.addEventListener('click', () => handleOpenLink(parsed.data.url, risk));
  }

  // Modal
  setupModal();
}

// ---- Findings renderer -------------------------------------------

function renderFindings(findings) {
  const list = document.getElementById('findingsList');
  list.innerHTML = '';

  // Filter out zero-score info items for the list; show positive only
  const visible = findings.filter(f => !(f.severity === 'info' && f.score === 0) || f.id === 'https-positive');

  if (visible.length === 0 || findings.every(f => f.score === 0)) {
    list.innerHTML = `
      <div class="findings-clean">
        <span>✓</span>
        No security issues detected. Content appears clean.
      </div>
    `;
    return;
  }

  // Show all, including info
  findings.forEach(f => {
    const item = document.createElement('div');
    item.className = `finding-item sev-${f.severity}`;
    item.innerHTML = `
      <span class="finding-sev">${escapeHtml(f.severity)}</span>
      <div class="finding-text">
        <strong>${escapeHtml(f.title)}</strong><br>
        <span style="opacity:0.75;font-size:0.83em;">${escapeHtml(f.detail)}</span>
      </div>
    `;
    list.appendChild(item);
  });
}

// ---- Parsed data renderer ----------------------------------------

function renderParsedData(parsed) {
  const grid = document.getElementById('parsedGrid');
  grid.innerHTML = '';

  const fields = getDisplayFields(parsed);
  if (!fields.length) {
    grid.innerHTML = '<span style="color:var(--text-dim);font-family:var(--font-mono);font-size:0.82rem;">No structured fields extracted.</span>';
    return;
  }

  fields.forEach(({ key, value, isLink }) => {
    if (!value && value !== 0) return;
    const item = document.createElement('div');
    item.className = 'parsed-item';

    const valStr = String(value);
    const valHtml = isLink
      ? `<a href="${escapeHtml(valStr)}" target="_blank" rel="noopener noreferrer">${escapeHtml(valStr)}</a>`
      : `<span>${escapeHtml(valStr)}</span>`;

    item.innerHTML = `
      <span class="parsed-key">${escapeHtml(key)}</span>
      <span class="parsed-value">${valHtml}</span>
    `;
    grid.appendChild(item);
  });
}

function getDisplayFields(parsed) {
  const d = parsed.data;
  switch (parsed.type) {
    case 'url':
      return [
        { key: 'URL',      value: d.url,      isLink: true },
        { key: 'Hostname', value: d.hostname },
        { key: 'Scheme',   value: d.scheme },
        { key: 'Path',     value: d.path && d.path !== '/' ? d.path : '' },
        { key: 'Query',    value: d.query },
        ...Object.entries(d.params || {}).map(([k, v]) => ({ key: `Param: ${k}`, value: v })),
      ];
    case 'wifi':
      return [
        { key: 'Network (SSID)', value: d.ssid },
        { key: 'Auth Type',      value: d.auth },
        { key: 'Hidden',         value: d.hidden ? 'Yes' : 'No' },
        { key: 'EAP Method',     value: d.eap },
        { key: 'Identity',       value: d.identity },
        // Password intentionally not shown
      ];
    case 'email':
      return [
        { key: 'Address', value: d.address },
        { key: 'Subject', value: d.subject },
        { key: 'Body',    value: d.body },
        { key: 'CC',      value: d.cc },
      ];
    case 'sms':
      return [
        { key: 'Number',  value: d.number },
        { key: 'Message', value: d.body },
      ];
    case 'phone':
      return [
        { key: 'Number', value: d.number },
      ];
    case 'payment':
      return [
        { key: 'VPA / Address', value: d.vpa || d.address },
        { key: 'Name',          value: d.name || d.label },
        { key: 'Amount',        value: d.amount ? `${d.amount} ${d.currency || ''}`.trim() : '' },
        { key: 'Note',          value: d.note || d.message },
        { key: 'Currency',      value: d.currency },
      ];
    case 'vcard':
      return [
        { key: 'Name',         value: d.name },
        { key: 'Phone',        value: d.phone },
        { key: 'Email',        value: d.email },
        { key: 'Organization', value: d.org },
        { key: 'Title',        value: d.title },
        { key: 'URL',          value: d.url, isLink: isValidUrl(d.url) },
        { key: 'Address',      value: d.address },
      ];
    case 'geo':
      return [
        { key: 'Latitude',  value: d.latitude },
        { key: 'Longitude', value: d.longitude },
        { key: 'Altitude',  value: d.altitude },
        { key: 'Query',     value: d.query },
        {
          key: 'Map Link',
          value: `https://www.google.com/maps?q=${d.latitude},${d.longitude}`,
          isLink: true,
        },
      ];
    case 'event':
      return [
        { key: 'Summary',  value: d.summary },
        { key: 'Location', value: d.location },
        { key: 'Start',    value: d.start },
        { key: 'End',      value: d.end },
        { key: 'URL',      value: d.url, isLink: isValidUrl(d.url) },
      ];
    default:
      return [{ key: 'Content', value: d.text || parsed.raw }];
  }
}

// ---- Open link ---------------------------------------------------

let pendingUrl = null;

function handleOpenLink(url, risk) {
  if (risk.level === 'safe' || risk.level === 'low') {
    safeOpenUrl(url);
    return;
  }

  // Show confirmation for medium/high/dangerous
  pendingUrl = url;
  const modal    = document.getElementById('confirmModal');
  const modalBody = document.getElementById('modalBody');

  modalBody.textContent = `This URL has a risk score of ${risk.score}/100 (${risk.level.toUpperCase()}). `
    + `Proceed only if you trust the source. The site might be malicious.`;

  modal.style.display = 'flex';
}

function safeOpenUrl(url) {
  // Open in new tab with strict security attributes
  const a = document.createElement('a');
  a.href     = url;
  a.target   = '_blank';
  a.rel      = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function setupModal() {
  const modal      = document.getElementById('confirmModal');
  const cancelBtn  = document.getElementById('modalCancel');
  const confirmBtn = document.getElementById('modalConfirm');

  cancelBtn.addEventListener('click', () => {
    modal.style.display = 'none';
    pendingUrl = null;
  });

  confirmBtn.addEventListener('click', () => {
    modal.style.display = 'none';
    if (pendingUrl) {
      safeOpenUrl(pendingUrl);
      pendingUrl = null;
    }
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
      pendingUrl = null;
    }
  });
}



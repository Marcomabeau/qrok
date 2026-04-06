/**
 * QRok — history-page.js
 * History page controller.
 */

import {
  loadHistory,
  deleteHistoryEntry,
  clearHistory,
  exportHistory,
  getHistoryStats,
} from './history.js';
import { parseQRContent } from './parser.js';
import { analyzeRisk }    from './risk-engine.js';
import { timeAgo, escapeHtml, truncate } from './utils.js';

document.addEventListener('DOMContentLoaded', initHistoryPage);

function initHistoryPage() {
  let currentFilter = 'all';
  let allEntries    = [];

  const listEl       = document.getElementById('historyList');
  const emptyEl      = document.getElementById('historyEmpty');
  const statsEl      = document.getElementById('historyStats');
  const filterEl     = document.getElementById('historyFilter');
  const actionsEl    = document.getElementById('historyActions');
  const statTotal    = document.getElementById('statTotal');
  const statSafe     = document.getElementById('statSafe');
  const statMedium   = document.getElementById('statMedium');
  const statHigh     = document.getElementById('statHigh');
  const exportBtn    = document.getElementById('exportHistory');
  const clearBtn     = document.getElementById('clearHistory');
  const deleteModal  = document.getElementById('deleteModal');
  const modalCancel  = document.getElementById('modalCancel');
  const modalConfirm = document.getElementById('modalConfirm');

  function load() {
    allEntries = loadHistory();
    renderStats();
    renderList();
  }

  function renderStats() {
    const stats = getHistoryStats();
    if (stats.total === 0) {
      statsEl.style.display   = 'none';
      filterEl.style.display  = 'none';
      actionsEl.style.display = 'none';
      return;
    }
    statsEl.style.display   = 'flex';
    filterEl.style.display  = 'flex';
    actionsEl.style.display = 'flex';
    statTotal.textContent   = stats.total;
    statSafe.textContent    = stats.safe + stats.low;
    statMedium.textContent  = stats.medium;
    statHigh.textContent    = stats.high + stats.dangerous;
  }

  function renderList() {
    const filtered = currentFilter === 'all'
      ? allEntries
      : allEntries.filter(e => e.level === currentFilter);

    listEl.innerHTML = '';

    if (filtered.length === 0) {
      emptyEl.style.display = 'flex';
      const h2 = emptyEl.querySelector('h2');
      const p  = emptyEl.querySelector('p');
      if (allEntries.length > 0) {
        if (h2) h2.textContent = 'No matches';
        if (p)  p.textContent  = `No scans with risk level "${currentFilter}".`;
      } else {
        if (h2) h2.textContent = 'No scans yet';
        if (p)  p.textContent  = 'Your scan history will appear here after you analyze QR codes.';
      }
      return;
    }

    emptyEl.style.display = 'none';
    filtered.forEach(entry => listEl.appendChild(buildHistoryItem(entry)));
  }

  function buildHistoryItem(entry) {
    const wrapper     = document.createElement('div');
    wrapper.className = 'history-item';
    wrapper.dataset.id = entry.id;

    const levelSlug  = (entry.level || 'safe').toLowerCase();
    const displayText = truncate(entry.summary || entry.raw || '', 70);

    wrapper.innerHTML = `
      <div class="history-risk-dot dot-${levelSlug}"></div>
      <div class="history-item-info">
        <div class="history-item-raw">${escapeHtml(displayText)}</div>
        <div class="history-item-meta">
          <span class="history-item-type">${escapeHtml(entry.typeLabel || entry.type || 'unknown')}</span>
          <span>${escapeHtml(timeAgo(entry.timestamp))}</span>
        </div>
      </div>
      <div class="history-item-right">
        <span class="history-risk-badge badge-${levelSlug}">${escapeHtml(levelSlug)}</span>
        <button class="history-delete-btn" data-id="${escapeHtml(entry.id)}" title="Delete">✕</button>
      </div>
    `;

    wrapper.addEventListener('click', (e) => {
      if (e.target.classList.contains('history-delete-btn')) return;
      viewEntry(entry);
    });

    wrapper.querySelector('.history-delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      animateDelete(entry.id, wrapper);
    });

    return wrapper;
  }

  function viewEntry(entry) {
    try {
      const parsed = parseQRContent(entry.raw);
      const risk   = analyzeRisk(parsed);
      const result = {
        id:        entry.id,
        raw:       entry.raw,
        parsed:    { type: parsed.type, label: parsed.label, data: parsed.data },
        risk: {
          score:    risk.score,
          level:    risk.level,
          verdict:  risk.verdict,
          icon:     risk.icon,
          color:    risk.color,
          findings: risk.findings,
        },
        timestamp: entry.timestamp,
      };
      sessionStorage.setItem('qrok_result', JSON.stringify(result));
    } catch (err) {
      console.warn('QRok: Could not rebuild result for navigation:', err.message);
    }
    window.location.href = `result.html?id=${encodeURIComponent(entry.id)}`;
  }

  function animateDelete(id, el) {
    el.style.transition    = 'opacity 0.2s, transform 0.2s';
    el.style.opacity       = '0';
    el.style.transform     = 'translateX(10px)';
    el.style.pointerEvents = 'none';
    setTimeout(() => {
      deleteHistoryEntry(id);
      allEntries = allEntries.filter(e => e.id !== id);
      el.remove();
      renderStats();
      if (listEl.children.length === 0) renderList();
    }, 220);
  }

  // Filter buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderList();
    });
  });

  // Export & clear
  exportBtn.addEventListener('click', exportHistory);

  clearBtn.addEventListener('click', () => {
    deleteModal.style.display = 'flex';
  });

  modalCancel.addEventListener('click', () => {
    deleteModal.style.display = 'none';
  });

  modalConfirm.addEventListener('click', () => {
    clearHistory();
    deleteModal.style.display = 'none';
    allEntries = [];
    renderStats();
    renderList();
  });

  deleteModal.addEventListener('click', (e) => {
    if (e.target === deleteModal) deleteModal.style.display = 'none';
  });

  load();
}

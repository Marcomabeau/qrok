/**
 * QRok — history.js
 * Manages scan history stored in localStorage.
 */

import { generateId } from './utils.js';

const STORAGE_KEY = 'qrok_history';
const MAX_ENTRIES  = 200;

/**
 * @typedef {Object} HistoryEntry
 * @property {string} id
 * @property {string} raw
 * @property {string} type
 * @property {string} typeLabel
 * @property {string} summary
 * @property {number} score
 * @property {string} level
 * @property {string[]} findingTitles
 * @property {number} timestamp
 */

/**
 * Load all history entries from localStorage.
 * @returns {HistoryEntry[]}
 */
export function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

/**
 * Save entries array to localStorage.
 * @param {HistoryEntry[]} entries
 */
function saveHistory(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (e) {
    console.warn('QRok: Could not save history:', e.message);
  }
}

/**
 * Add a new scan entry to history.
 * Deduplicates by raw content within the last 60s.
 * @param {object} params
 * @param {string}  params.raw
 * @param {import('./parser.js').ParsedQR}  params.parsed
 * @param {import('./risk-engine.js').RiskResult} params.risk
 * @returns {HistoryEntry}
 */
export function addHistoryEntry({ raw, parsed, risk }) {
  const entries = loadHistory();
  const now     = Date.now();

  // Deduplicate: same raw content within 60 seconds
  const recent = entries.find(e => e.raw === raw && now - e.timestamp < 60_000);
  if (recent) return recent;

  const entry = {
    id:            generateId(),
    raw:           raw,
    type:          parsed.type,
    typeLabel:     parsed.label,
    summary:       getSummaryText(parsed),
    score:         risk.score,
    level:         risk.level,
    findingTitles: risk.findings.map(f => f.title),
    parsedData:    sanitizeParsedData(parsed.data, parsed.type),
    timestamp:     now,
  };

  // Prepend newest, enforce max
  const updated = [entry, ...entries].slice(0, MAX_ENTRIES);
  saveHistory(updated);
  return entry;
}

/**
 * Get a single entry by ID.
 * @param {string} id
 * @returns {HistoryEntry|null}
 */
export function getHistoryEntry(id) {
  return loadHistory().find(e => e.id === id) ?? null;
}

/**
 * Delete a single history entry by ID.
 * @param {string} id
 * @returns {boolean}
 */
export function deleteHistoryEntry(id) {
  const entries = loadHistory();
  const updated = entries.filter(e => e.id !== id);
  if (updated.length === entries.length) return false;
  saveHistory(updated);
  return true;
}

/**
 * Clear all history.
 */
export function clearHistory() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}

/**
 * Export history as a JSON blob download.
 */
export function exportHistory() {
  const entries = loadHistory();
  const blob    = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
  const url     = URL.createObjectURL(blob);
  const a       = document.createElement('a');
  a.href        = url;
  a.download    = `qrok-history-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Get history statistics.
 * @returns {{ total: number, safe: number, low: number, medium: number, high: number, dangerous: number }}
 */
export function getHistoryStats() {
  const entries = loadHistory();
  return {
    total:     entries.length,
    safe:      entries.filter(e => e.level === 'safe').length,
    low:       entries.filter(e => e.level === 'low').length,
    medium:    entries.filter(e => e.level === 'medium').length,
    high:      entries.filter(e => e.level === 'high').length,
    dangerous: entries.filter(e => e.level === 'dangerous').length,
  };
}

// ---- Helpers -----------------------------------------------------

function getSummaryText(parsed) {
  switch (parsed.type) {
    case 'url':     return parsed.data.hostname || parsed.data.url || parsed.raw;
    case 'wifi':    return parsed.data.ssid ? `Wi-Fi: ${parsed.data.ssid}` : 'Wi-Fi QR';
    case 'email':   return parsed.data.address || parsed.raw;
    case 'sms':     return `SMS: ${parsed.data.number || parsed.raw}`;
    case 'phone':   return parsed.data.number || parsed.raw;
    case 'payment': return parsed.data.vpa || parsed.data.address || 'Payment QR';
    case 'vcard':   return parsed.data.name || 'Contact';
    case 'geo':     return `${parsed.data.latitude}, ${parsed.data.longitude}`;
    case 'event':   return parsed.data.summary || 'Calendar Event';
    default:        return (parsed.data.text || parsed.raw || '').slice(0, 80);
  }
}

function sanitizeParsedData(data, type) {
  // Don't persist Wi-Fi passwords in plain text history
  if (type === 'wifi') {
    const { password, ...safe } = data; // eslint-disable-line no-unused-vars
    return { ...safe, password: password ? '[redacted]' : '' };
  }
  return data;
}

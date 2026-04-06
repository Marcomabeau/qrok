/**
 * QRok — utils.js
 * Shared utility functions used across the app.
 */

/**
 * Sanitize a string for safe HTML insertion.
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Truncate a string to a max length with ellipsis.
 * @param {string} str
 * @param {number} max
 * @returns {string}
 */
export function truncate(str, max = 80) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

/**
 * Format a timestamp to a human-readable string.
 * @param {number|string} ts - Unix timestamp in ms or ISO string
 * @returns {string}
 */
export function formatTimestamp(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return 'Unknown time';
  }
}

/**
 * Format a relative time string (e.g. "2 minutes ago").
 * @param {number|string} ts
 * @returns {string}
 */
export function timeAgo(ts) {
  const now = Date.now();
  const then = new Date(ts).getTime();
  const diff = Math.max(0, now - then);

  const sec  = Math.floor(diff / 1000);
  const min  = Math.floor(sec / 60);
  const hr   = Math.floor(min / 60);
  const day  = Math.floor(hr / 24);

  if (day > 0)  return `${day}d ago`;
  if (hr > 0)   return `${hr}h ago`;
  if (min > 0)  return `${min}m ago`;
  if (sec > 5)  return `${sec}s ago`;
  return 'just now';
}

/**
 * Generate a short random ID.
 * @returns {string}
 */
export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/**
 * Debounce a function call.
 * @param {Function} fn
 * @param {number} delay
 * @returns {Function}
 */
export function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Copy text to clipboard.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older browsers
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Safely parse JSON, returning a default on failure.
 * @param {string} str
 * @param {*} def
 * @returns {*}
 */
export function safeJsonParse(str, def = null) {
  try {
    return JSON.parse(str);
  } catch {
    return def;
  }
}

/**
 * Check if a string is a valid absolute URL.
 * @param {string} str
 * @returns {boolean}
 */
export function isValidUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Extract the hostname from a URL string safely.
 * @param {string} url
 * @returns {string|null}
 */
export function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Extract query parameters from a URL.
 * @param {string} url
 * @returns {Record<string,string>}
 */
export function getQueryParams(url) {
  try {
    const u = new URL(url);
    const result = {};
    u.searchParams.forEach((v, k) => { result[k] = v; });
    return result;
  } catch {
    return {};
  }
}

/**
 * Convert a File object to a data URL.
 * @param {File} file
 * @returns {Promise<string>}
 */
export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Load an image from a data URL into an HTMLImageElement.
 * @param {string} src
 * @returns {Promise<HTMLImageElement>}
 */
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

/**
 * QRok — parser.js
 * Detects and parses QR content into typed, structured objects.
 *
 * Supported types:
 *   url | wifi | email | sms | phone | payment | vcard | mecard | geo | event | plain
 */

/**
 * @typedef {Object} ParsedQR
 * @property {string} type      - Content type identifier
 * @property {string} label     - Human-readable type label
 * @property {Object} data      - Parsed fields
 * @property {string} raw       - Original raw string
 */

/**
 * Parse raw QR content into a structured object.
 * @param {string} raw
 * @returns {ParsedQR}
 */
export function parseQRContent(raw) {
  if (typeof raw !== 'string') {
    raw = String(raw ?? '');
  }

  const trimmed = raw.trim();

  // URL (http / https / ftp)
  if (/^https?:\/\//i.test(trimmed) || /^ftp:\/\//i.test(trimmed)) {
    return parseUrl(trimmed);
  }

  // Wi-Fi
  if (/^WIFI:/i.test(trimmed)) {
    return parseWifi(trimmed);
  }

  // Email (mailto:)
  if (/^mailto:/i.test(trimmed)) {
    return parseMailto(trimmed);
  }

  // SMS
  if (/^sms(to)?:/i.test(trimmed)) {
    return parseSms(trimmed);
  }

  // Phone
  if (/^tel:/i.test(trimmed)) {
    return parsePhone(trimmed);
  }

  // Bitcoin / crypto payment
  if (/^bitcoin:/i.test(trimmed) || /^ethereum:/i.test(trimmed) || /^litecoin:/i.test(trimmed)) {
    return parseCrypto(trimmed);
  }

  // UPI payment (India)
  if (/^upi:\/\//i.test(trimmed)) {
    return parseUpi(trimmed);
  }

  // vCard
  if (/^BEGIN:VCARD/i.test(trimmed)) {
    return parseVcard(trimmed);
  }

  // MECARD
  if (/^MECARD:/i.test(trimmed)) {
    return parseMecard(trimmed);
  }

  // Geo location
  if (/^geo:/i.test(trimmed)) {
    return parseGeo(trimmed);
  }

  // Calendar event
  if (/^BEGIN:VEVENT/i.test(trimmed)) {
    return parseEvent(trimmed);
  }

  // Plain email (no mailto:)
  if (/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(trimmed)) {
    return {
      type: 'email',
      label: 'Email Address',
      data: { address: trimmed },
      raw: trimmed,
    };
  }

  // Plain phone (digits, spaces, dashes, parens, +)
  if (/^\+?[\d\s\-().]{7,20}$/.test(trimmed)) {
    return {
      type: 'phone',
      label: 'Phone Number',
      data: { number: trimmed },
      raw: trimmed,
    };
  }

  // Fallback: plain text
  return {
    type: 'plain',
    label: 'Plain Text',
    data: { text: trimmed },
    raw: trimmed,
  };
}

// ---- Type parsers ------------------------------------------------

function parseUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { /* ignore */ }

  const data = {
    url: raw,
    scheme:   url?.protocol?.replace(':', '') ?? '',
    hostname: url?.hostname ?? '',
    port:     url?.port     ?? '',
    path:     url?.pathname ?? '',
    query:    url?.search   ?? '',
    fragment: url?.hash     ?? '',
    params:   {},
  };

  if (url?.searchParams) {
    url.searchParams.forEach((v, k) => { data.params[k] = v; });
  }

  return { type: 'url', label: 'URL', data, raw };
}

function parseWifi(raw) {
  // Format: WIFI:T:<auth>;S:<ssid>;P:<password>;H:<hidden>;;
  const data = {
    ssid:     extractWifiField(raw, 'S'),
    password: extractWifiField(raw, 'P'),
    auth:     extractWifiField(raw, 'T') || 'WPA',
    hidden:   extractWifiField(raw, 'H') === 'true',
    eap:      extractWifiField(raw, 'E') || '',
    identity: extractWifiField(raw, 'I') || '',
  };
  return { type: 'wifi', label: 'Wi-Fi Network', data, raw };
}

function extractWifiField(raw, field) {
  // Handles escaped semicolons (\;) in values
  const regex = new RegExp(`(?:^|;)${field}:((?:[^;\\\\]|\\\\.)*)`, 'i');
  const match = raw.match(regex);
  if (!match) return '';
  return match[1].replace(/\\(.)/g, '$1');
}

function parseMailto(raw) {
  // mailto:user@example.com?subject=Hello&body=World
  const withoutScheme = raw.replace(/^mailto:/i, '');
  const [address, queryStr] = withoutScheme.split('?');
  const params = {};
  if (queryStr) {
    new URLSearchParams(queryStr).forEach((v, k) => { params[k.toLowerCase()] = v; });
  }
  return {
    type: 'email',
    label: 'Email',
    data: {
      address:  decodeURIComponent(address || ''),
      subject:  params.subject || '',
      body:     params.body    || '',
      cc:       params.cc      || '',
      bcc:      params.bcc     || '',
    },
    raw,
  };
}

function parseSms(raw) {
  // SMSTO:+123:message  or  sms:+123?body=message
  const withoutScheme = raw.replace(/^sms(to)?:/i, '');
  let number = '', body = '';

  if (withoutScheme.includes('?')) {
    const [n, q] = withoutScheme.split('?');
    number = n;
    body = new URLSearchParams(q).get('body') || '';
  } else if (withoutScheme.includes(':')) {
    const idx = withoutScheme.indexOf(':');
    number = withoutScheme.slice(0, idx);
    body   = withoutScheme.slice(idx + 1);
  } else {
    number = withoutScheme;
  }

  return { type: 'sms', label: 'SMS', data: { number, body }, raw };
}

function parsePhone(raw) {
  const number = raw.replace(/^tel:/i, '');
  return { type: 'phone', label: 'Phone Number', data: { number }, raw };
}

function parseCrypto(raw) {
  const scheme = raw.split(':')[0].toLowerCase();
  let address = '', amount = '', label = '', message = '';
  try {
    const withoutScheme = raw.replace(/^[^:]+:/i, '');
    const [addr, queryStr] = withoutScheme.split('?');
    address = addr;
    if (queryStr) {
      const p = new URLSearchParams(queryStr);
      amount  = p.get('amount')  || p.get('value') || '';
      label   = p.get('label')   || '';
      message = p.get('message') || '';
    }
  } catch { /* ignore */ }
  return {
    type: 'payment',
    label: 'Crypto Payment',
    data: { currency: scheme, address, amount, label, message },
    raw,
  };
}

function parseUpi(raw) {
  // upi://pay?pa=vpa@bank&pn=Name&am=100&cu=INR
  const params = {};
  try {
    const u = new URL(raw);
    u.searchParams.forEach((v, k) => { params[k] = v; });
  } catch { /* ignore */ }
  return {
    type: 'payment',
    label: 'UPI Payment',
    data: {
      vpa:      params.pa  || '',
      name:     params.pn  || '',
      amount:   params.am  || '',
      currency: params.cu  || 'INR',
      note:     params.tn  || '',
    },
    raw,
  };
}

function parseVcard(raw) {
  const get = (field) => {
    const regex = new RegExp(`^${field}[^:]*:(.*)$`, 'im');
    const m = raw.match(regex);
    return m ? m[1].trim().replace(/\\n/gi, '\n') : '';
  };

  const name  = get('FN') || get('N').replace(';', ' ').trim();
  const phone = get('TEL');
  const email = get('EMAIL');
  const org   = get('ORG');
  const title = get('TITLE');
  const url   = get('URL');
  const adr   = get('ADR').replace(/;/g, ', ').replace(/^,\s*/, '').trim();

  return {
    type: 'vcard',
    label: 'Contact (vCard)',
    data: { name, phone, email, org, title, url, address: adr },
    raw,
  };
}

function parseMecard(raw) {
  const withoutScheme = raw.replace(/^MECARD:/i, '').replace(/;;$/, '');
  const fields = {};
  withoutScheme.split(';').forEach(part => {
    const idx = part.indexOf(':');
    if (idx > -1) {
      fields[part.slice(0, idx).trim().toUpperCase()] = part.slice(idx + 1).trim();
    }
  });
  return {
    type: 'vcard',
    label: 'Contact (MECARD)',
    data: {
      name:  fields.N || '',
      phone: fields.TEL || '',
      email: fields.EMAIL || '',
      org:   fields.ORG || '',
      url:   fields.URL || '',
    },
    raw,
  };
}

function parseGeo(raw) {
  // geo:lat,lon,alt?q=query
  const withoutScheme = raw.replace(/^geo:/i, '');
  const [coords, queryStr] = withoutScheme.split('?');
  const parts = coords.split(',');
  const lat = parseFloat(parts[0]) || 0;
  const lon = parseFloat(parts[1]) || 0;
  const alt = parseFloat(parts[2]) || null;
  const query = queryStr ? new URLSearchParams(queryStr).get('q') || '' : '';
  return {
    type: 'geo',
    label: 'Location',
    data: { latitude: lat, longitude: lon, altitude: alt, query },
    raw,
  };
}

function parseEvent(raw) {
  const get = (field) => {
    const regex = new RegExp(`^${field}[^:]*:(.*)$`, 'im');
    const m = raw.match(regex);
    return m ? m[1].trim() : '';
  };
  return {
    type: 'event',
    label: 'Calendar Event',
    data: {
      summary:  get('SUMMARY'),
      location: get('LOCATION'),
      start:    get('DTSTART'),
      end:      get('DTEND'),
      desc:     get('DESCRIPTION'),
      url:      get('URL'),
    },
    raw,
  };
}

/**
 * Get a display-friendly summary for a parsed QR.
 * @param {ParsedQR} parsed
 * @returns {string}
 */
export function getDisplaySummary(parsed) {
  switch (parsed.type) {
    case 'url':      return parsed.data.hostname || parsed.data.url;
    case 'wifi':     return parsed.data.ssid ? `Network: ${parsed.data.ssid}` : 'Wi-Fi QR';
    case 'email':    return parsed.data.address || 'Email';
    case 'sms':      return parsed.data.number ? `SMS to ${parsed.data.number}` : 'SMS';
    case 'phone':    return parsed.data.number || 'Phone';
    case 'payment':  return parsed.data.vpa || parsed.data.address || 'Payment QR';
    case 'vcard':    return parsed.data.name || 'Contact';
    case 'geo':      return parsed.data.query || `${parsed.data.latitude}, ${parsed.data.longitude}`;
    case 'event':    return parsed.data.summary || 'Calendar Event';
    case 'plain':    return parsed.data.text.slice(0, 60) + (parsed.data.text.length > 60 ? '…' : '');
    default:         return parsed.raw.slice(0, 60);
  }
}

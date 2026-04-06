/**
 * QRok — risk-engine.js
 * Heuristic-based QR security analysis engine.
 *
 * Each check is self-contained and produces a Finding.
 * Score accumulates and maps to a risk level.
 *
 * Risk levels: safe(0-9) | low(10-24) | medium(25-49) | high(50-74) | dangerous(75+)
 */

/**
 * @typedef {Object} Finding
 * @property {string} id        - Unique rule ID
 * @property {string} severity  - 'info' | 'low' | 'medium' | 'high' | 'critical'
 * @property {string} title     - Short description
 * @property {string} detail    - Longer explanation
 * @property {number} score     - Points contributed to total
 */

/**
 * @typedef {Object} RiskResult
 * @property {number}    score     - 0-100 numeric risk score
 * @property {string}    level     - 'safe' | 'low' | 'medium' | 'high' | 'dangerous'
 * @property {string}    verdict   - Human-readable verdict
 * @property {Finding[]} findings  - All triggered findings
 * @property {string}    icon      - Emoji icon for the level
 * @property {string}    color     - CSS class suffix for the level
 */

// ---- Constants ---------------------------------------------------

const URL_SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 'goo.gl', 't.co', 'ow.ly', 'is.gd',
  'buff.ly', 'rebrand.ly', 'cutt.ly', 'rb.gy', 'short.io',
  'tiny.cc', 'clck.ru', 'shorte.st', 'adf.ly', 'bc.vc',
  'rotf.lol', 'v.gd', 'hyperurl.co', 'su.pr', 'mcaf.ee',
  'x.co', 'po.st', 'lnkd.in', 'dlvr.it', 'ht.ly',
]);

const SUSPICIOUS_TLDS = new Set([
  '.tk', '.ml', '.ga', '.cf', '.gq', '.xyz', '.top', '.club',
  '.work', '.online', '.site', '.website', '.space', '.fun',
  '.click', '.download', '.loan', '.stream', '.gdn', '.review',
  '.country', '.kim', '.racing', '.party', '.win', '.trade',
  '.webcam', '.science', '.date', '.accountants', '.rocks',
  '.pw', '.icu', '.buzz', '.rest', '.monster', '.cfd',
]);

const DANGEROUS_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.msi', '.vbs', '.ps1', '.jar',
  '.dmg', '.app', '.deb', '.rpm', '.sh', '.scr', '.pif',
  '.com', '.hta', '.js', '.jse', '.wsf', '.wsh', '.apk',
  '.ipa', '.run', '.bin', '.iso', '.img', '.dll', '.sys',
]);

const SUSPICIOUS_KEYWORDS = [
  'login', 'signin', 'sign-in', 'log-in', 'verify', 'verification',
  'account', 'update', 'confirm', 'secure', 'security', 'password',
  'credential', 'banking', 'wallet', 'paypal', 'payment', 'invoice',
  'wire', 'transfer', 'crypto', 'bitcoin', 'prize', 'winner', 'claim',
  'reward', 'free', 'click-here', 'clickhere', 'urgent', 'immediate',
  'suspended', 'unusual', 'activity', 'recovery', 'reset', 'helpdesk',
  'support-team', 'admin', 'webmaster',
];

const REDIRECT_PARAMS = new Set([
  'url', 'redirect', 'return', 'returnurl', 'returnto', 'next',
  'dest', 'destination', 'target', 'goto', 'forward', 'continue',
  'redir', 'redirect_uri', 'callback', 'successurl', 'failurl',
  'ref', 'out', 'link', 'go', 'jump',
]);

const SCRIPT_INJECTION_PATTERNS = [
  /javascript:/i,
  /data:text\/html/i,
  /data:application\/x-javascript/i,
  /<script/i,
  /onerror\s*=/i,
  /onload\s*=/i,
  /onclick\s*=/i,
  /eval\s*\(/i,
  /document\.write/i,
  /document\.cookie/i,
  /window\.location/i,
  /base64.*<script/i,
];

// ---- Score → Level mapping ---------------------------------------

function scoreToLevel(score) {
  if (score <= 0)  return { level: 'safe',      verdict: 'No threats detected',        icon: '✓',  color: 'safe' };
  if (score <= 9)  return { level: 'safe',      verdict: 'Appears safe',               icon: '✓',  color: 'safe' };
  if (score <= 24) return { level: 'low',       verdict: 'Low risk, exercise caution', icon: '◑',  color: 'low' };
  if (score <= 49) return { level: 'medium',    verdict: 'Moderate risk detected',     icon: '⚠',  color: 'medium' };
  if (score <= 74) return { level: 'high',      verdict: 'High risk — be careful',     icon: '⛔', color: 'high' };
  return                   { level: 'dangerous', verdict: 'Dangerous — do not proceed', icon: '☠',  color: 'dangerous' };
}

// ---- Main entry point -------------------------------------------

/**
 * Analyze a parsed QR result and return risk findings.
 * @param {import('./parser.js').ParsedQR} parsed
 * @returns {RiskResult}
 */
export function analyzeRisk(parsed) {
  const findings = [];
  let score = 0;

  const add = (finding) => {
    findings.push(finding);
    score += finding.score;
  };

  // Run type-specific checks
  switch (parsed.type) {
    case 'url':
      runUrlChecks(parsed, add);
      break;
    case 'wifi':
      runWifiChecks(parsed, add);
      break;
    case 'email':
      runEmailChecks(parsed, add);
      break;
    case 'sms':
      runSmsChecks(parsed, add);
      break;
    case 'payment':
      runPaymentChecks(parsed, add);
      break;
    case 'plain':
      runPlainTextChecks(parsed, add);
      break;
    default:
      break;
  }

  // Universal checks
  runUniversalChecks(parsed, add);

  // Clamp score 0-100
  const clampedScore = Math.min(100, Math.max(0, Math.round(score)));
  const levelInfo = scoreToLevel(clampedScore);

  // Sort findings by score desc
  findings.sort((a, b) => b.score - a.score);

  return {
    score:    clampedScore,
    findings,
    ...levelInfo,
  };
}

// ---- URL checks --------------------------------------------------

function runUrlChecks(parsed, add) {
  const { data } = parsed;
  const url      = data.url  || '';
  const hostname = data.hostname || '';
  const scheme   = data.scheme || '';
  const path     = data.path || '';
  const query    = data.query || '';
  const params   = data.params || {};

  // 1. HTTP (not HTTPS)
  if (scheme === 'http') {
    add({
      id: 'insecure-http',
      severity: 'medium',
      title: 'Insecure HTTP connection',
      detail: 'This URL uses HTTP instead of HTTPS. Traffic can be intercepted and modified by third parties. Modern sites should use HTTPS.',
      score: 20,
    });
  }

  // 2. IP address instead of domain
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/;
  if (ipv4Pattern.test(hostname)) {
    add({
      id: 'ip-address',
      severity: 'high',
      title: 'IP address used instead of domain',
      detail: `The URL points directly to an IP address (${hostname}) rather than a domain name. Legitimate services almost never expose raw IPs in QR codes — this is a common phishing indicator.`,
      score: 35,
    });
  }

  // 3. URL shortener
  const baseDomain = hostname.replace(/^www\./, '');
  if (URL_SHORTENERS.has(baseDomain)) {
    add({
      id: 'url-shortener',
      severity: 'medium',
      title: 'URL shortener detected',
      detail: `The domain "${hostname}" is a well-known URL shortening service. Short links hide the actual destination, making it impossible to evaluate the real URL without following it.`,
      score: 25,
    });
  }

  // 4. Suspicious TLD
  const domainParts = hostname.split('.');
  const tld = domainParts.length > 1 ? '.' + domainParts.slice(-1)[0].toLowerCase() : '';
  if (SUSPICIOUS_TLDS.has(tld)) {
    add({
      id: 'suspicious-tld',
      severity: 'medium',
      title: `Suspicious top-level domain (${tld})`,
      detail: `The domain uses the "${tld}" TLD, which is commonly abused for phishing, spam, and malware campaigns due to free or near-free registration with minimal vetting.`,
      score: 20,
    });
  }

  // 5. Punycode / homograph attack
  if (hostname.startsWith('xn--') || hostname.includes('.xn--')) {
    add({
      id: 'punycode',
      severity: 'high',
      title: 'Punycode internationalized domain detected',
      detail: `The domain "${hostname}" uses Punycode encoding (xn--). This is used in homograph attacks where lookalike Unicode characters impersonate legitimate domains (e.g., "pаypal.com" using Cyrillic "а").`,
      score: 40,
    });
  }

  // 6. Script injection in URL
  const fullUrl = url;
  for (const pattern of SCRIPT_INJECTION_PATTERNS) {
    if (pattern.test(fullUrl)) {
      add({
        id: 'script-injection',
        severity: 'critical',
        title: 'Script injection pattern detected',
        detail: `The URL contains a pattern that matches known JavaScript injection or XSS techniques (matched: ${pattern.source}). This is a strong indicator of a malicious QR code.`,
        score: 60,
      });
      break;
    }
  }

  // 7. Redirect parameter
  const paramKeys = Object.keys(params).map(k => k.toLowerCase());
  const foundRedirectParam = paramKeys.find(k => REDIRECT_PARAMS.has(k));
  if (foundRedirectParam) {
    const redirectValue = params[Object.keys(params).find(k => k.toLowerCase() === foundRedirectParam)] || '';
    add({
      id: 'redirect-param',
      severity: 'medium',
      title: `Open redirect parameter found (${foundRedirectParam})`,
      detail: `The URL contains a query parameter ("${foundRedirectParam}") commonly used in open redirect attacks. The value "${redirectValue.slice(0, 60)}" may redirect you to a different, potentially malicious site.`,
      score: 25,
    });
  }

  // 8. Suspicious keywords in URL
  const urlLower = url.toLowerCase();
  const matchedKeywords = SUSPICIOUS_KEYWORDS.filter(kw => urlLower.includes(kw));
  if (matchedKeywords.length > 0) {
    const severity = matchedKeywords.length >= 3 ? 'high' : 'medium';
    const pts      = matchedKeywords.length >= 3 ? 30 : 15;
    add({
      id: 'suspicious-keywords',
      severity,
      title: `Suspicious keywords in URL (${matchedKeywords.slice(0, 3).join(', ')})`,
      detail: `The URL contains ${matchedKeywords.length} keyword(s) commonly associated with phishing pages: ${matchedKeywords.join(', ')}. Legitimate sites rarely include these terms in their URLs.`,
      score: pts,
    });
  }

  // 9. Dangerous file extension
  const pathLower = path.toLowerCase();
  const matchedExt = Array.from(DANGEROUS_EXTENSIONS).find(ext => pathLower.endsWith(ext));
  if (matchedExt) {
    add({
      id: 'dangerous-extension',
      severity: 'critical',
      title: `Dangerous file type: ${matchedExt}`,
      detail: `The URL path ends with "${matchedExt}", which is an executable or potentially harmful file type. Opening or downloading this file could infect your device with malware.`,
      score: 55,
    });
  }

  // 10. Excessive length / obfuscation
  if (url.length > 300) {
    add({
      id: 'long-url',
      severity: 'low',
      title: 'Unusually long URL',
      detail: `The URL is ${url.length} characters long. Extremely long URLs are often used to obscure the true destination or overwhelm security filters. Inspect the URL carefully.`,
      score: 10,
    });
  }

  // 11. Many subdomains (subdomain stacking attack)
  const subdomainCount = domainParts.length - 2; // remove tld + root
  if (subdomainCount >= 3) {
    add({
      id: 'subdomain-stacking',
      severity: 'medium',
      title: 'Excessive subdomain nesting',
      detail: `The hostname has ${subdomainCount} subdomain levels (e.g., bank.secure.legit.${domainParts.slice(-2).join('.')}). Attackers use this to make phishing URLs look like they belong to a trusted domain.`,
      score: 20,
    });
  }

  // 12. Non-standard port
  const port = data.port;
  if (port && !['80', '443', '8080', '8443'].includes(port)) {
    add({
      id: 'unusual-port',
      severity: 'low',
      title: `Unusual port number: ${port}`,
      detail: `The URL uses port ${port} instead of the standard HTTP/HTTPS ports (80/443). While sometimes legitimate, non-standard ports can indicate a test environment, proxied traffic, or an attempt to evade filtering.`,
      score: 10,
    });
  }

  // 13. Double extension in path (e.g. invoice.pdf.exe)
  const doubleExtPattern = /\.\w{2,4}\.\w{2,4}$/;
  if (doubleExtPattern.test(path)) {
    add({
      id: 'double-extension',
      severity: 'high',
      title: 'Double file extension in path',
      detail: `The file path contains a double extension (e.g., "document.pdf.exe"). This is a classic malware distribution trick to disguise executable files as harmless document types.`,
      score: 40,
    });
  }

  // 14. URL encoded tricks / percent spam
  const percentCount = (url.match(/%[0-9a-fA-F]{2}/g) || []).length;
  if (percentCount > 8) {
    add({
      id: 'heavy-encoding',
      severity: 'medium',
      title: 'Heavy URL encoding (obfuscation)',
      detail: `The URL contains ${percentCount} percent-encoded characters. Excessive encoding is often used to disguise malicious content from URL scanners and to confuse users reading the address.`,
      score: 20,
    });
  }

  // 15. Credential pattern in URL (user:pass@host)
  if (/@/.test(hostname) || /:[^/]+@/.test(url)) {
    add({
      id: 'credentials-in-url',
      severity: 'critical',
      title: 'Credentials embedded in URL',
      detail: 'The URL appears to contain authentication credentials (user:password@host) or uses the @ symbol to disguise the real hostname. This technique is commonly used in phishing attacks.',
      score: 50,
    });
  }

  // INFO: HTTPS
  if (scheme === 'https' && !ipv4Pattern.test(hostname)) {
    add({
      id: 'https-positive',
      severity: 'info',
      title: 'Encrypted HTTPS connection',
      detail: 'The URL uses HTTPS, which encrypts data in transit. Note: HTTPS does not guarantee a site is safe — phishing sites also use HTTPS.',
      score: 0,
    });
  }
}

// ---- Wi-Fi checks -----------------------------------------------

function runWifiChecks(parsed, add) {
  const { data } = parsed;

  if (!data.password && data.auth !== 'nopass') {
    add({
      id: 'wifi-no-password',
      severity: 'low',
      title: 'Wi-Fi network has no password',
      detail: 'This QR code connects to an open (unsecured) Wi-Fi network. Open networks allow anyone to monitor your traffic. Avoid transmitting sensitive data on open networks.',
      score: 10,
    });
  }

  if (data.auth === 'WEP') {
    add({
      id: 'wifi-wep',
      severity: 'high',
      title: 'WEP encryption is broken',
      detail: 'This network uses WEP (Wired Equivalent Privacy), an outdated and fully compromised encryption standard. WEP can be cracked in minutes. Treat this network as insecure.',
      score: 40,
    });
  }

  if (data.ssid && data.ssid.toLowerCase().includes('free')) {
    add({
      id: 'wifi-free-ssid',
      severity: 'low',
      title: 'SSID contains "free" — possible honeypot',
      detail: `The network name "${data.ssid}" contains the word "free". Public QR codes connecting to "free" networks can be evil twin or honeypot attacks designed to intercept traffic.`,
      score: 8,
    });
  }
}

// ---- Email checks -----------------------------------------------

function runEmailChecks(parsed, add) {
  const { data } = parsed;
  const addr = (data.address || '').toLowerCase();

  if (!addr.includes('@') || !addr.includes('.')) {
    add({
      id: 'email-malformed',
      severity: 'medium',
      title: 'Malformed email address',
      detail: `The email address "${data.address}" does not appear to be valid. Malformed addresses can be used to bypass validation checks.`,
      score: 15,
    });
  }

  const suspiciousEmailDomains = ['tempmail.', 'guerrillamail.', 'throwam.', 'sharklasers.', 'mailinator.', 'trashmail.'];
  if (suspiciousEmailDomains.some(d => addr.includes(d))) {
    add({
      id: 'email-disposable',
      severity: 'medium',
      title: 'Disposable/temporary email domain',
      detail: `The domain in "${addr}" is associated with disposable or temporary email services. These are sometimes used for fraudulent activity or spam.`,
      score: 20,
    });
  }
}

// ---- SMS checks -------------------------------------------------

function runSmsChecks(parsed, add) {
  const { data } = parsed;
  const body = (data.body || '').toLowerCase();
  const suspiciousSmsKeywords = ['click', 'link', 'verify', 'win', 'prize', 'code', 'otp', 'free', 'urgent'];
  const matched = suspiciousSmsKeywords.filter(k => body.includes(k));
  if (matched.length > 0) {
    add({
      id: 'sms-suspicious-body',
      severity: 'medium',
      title: 'Suspicious SMS body content',
      detail: `The SMS body contains keywords associated with scams or phishing: ${matched.join(', ')}. Be cautious of QR codes that send pre-filled SMS messages with promotional or verification content.`,
      score: 20,
    });
  }
}

// ---- Payment checks ---------------------------------------------

function runPaymentChecks(parsed, add) {
  add({
    id: 'payment-qr-info',
    severity: 'info',
    title: 'Payment QR — verify recipient before proceeding',
    detail: 'This QR code initiates a payment. Always verify the recipient name and amount carefully before confirming. Payment QR codes can be replaced with malicious ones at point-of-sale.',
    score: 5,
  });
}

// ---- Plain text checks ------------------------------------------

function runPlainTextChecks(parsed, add) {
  const text = (parsed.data.text || '').toLowerCase();

  for (const pattern of SCRIPT_INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      add({
        id: 'plain-script-injection',
        severity: 'critical',
        title: 'Script injection pattern in plain text',
        detail: 'The plain text content contains a pattern matching known script injection techniques. If this content is rendered or executed, it could lead to cross-site scripting (XSS).',
        score: 50,
      });
      break;
    }
  }

  // URLs embedded in plain text
  if (/https?:\/\//i.test(text)) {
    add({
      id: 'plain-contains-url',
      severity: 'low',
      title: 'URL embedded in plain text',
      detail: 'The plain text content includes a URL. Scan this URL separately or exercise caution before visiting it.',
      score: 5,
    });
  }
}

// ---- Universal checks -------------------------------------------

function runUniversalChecks(parsed, add) {
  const raw = parsed.raw || '';

  // Content length
  if (raw.length > 2000) {
    add({
      id: 'large-payload',
      severity: 'low',
      title: 'Unusually large QR payload',
      detail: `This QR code contains ${raw.length} characters. Most legitimate QR codes are much smaller. Large payloads can be used to embed obfuscated malicious content.`,
      score: 8,
    });
  }

  // Base64 blobs
  const base64Pattern = /[A-Za-z0-9+/]{100,}={0,2}/;
  if (base64Pattern.test(raw)) {
    add({
      id: 'base64-blob',
      severity: 'medium',
      title: 'Large Base64-encoded data detected',
      detail: 'The QR content contains a long Base64 string, which could be used to encode hidden scripts, malware droppers, or obfuscated URLs.',
      score: 20,
    });
  }

  // Null bytes / control characters
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(raw)) {
    add({
      id: 'control-chars',
      severity: 'high',
      title: 'Control characters in QR content',
      detail: 'The QR payload contains non-printable control characters. These are never present in legitimate QR codes and are often used to confuse parsers or hide malicious content.',
      score: 35,
    });
  }
}

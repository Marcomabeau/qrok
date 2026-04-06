/**
 * QRok — scanner.js
 * Handles camera-based live scanning and image file QR decoding.
 * Uses jsQR for decoding.
 */

import { fileToDataUrl, loadImage } from './utils.js';

let cameraStream   = null;
let scanInterval   = null;
let onResultCb     = null;
let isScanning     = false;

const SCAN_INTERVAL_MS = 150; // scan every 150ms for responsiveness

// ---- Camera scanning ---------------------------------------------

/**
 * Start camera scanning.
 * @param {HTMLVideoElement} videoEl
 * @param {HTMLCanvasElement} canvasEl
 * @param {string} [deviceId]
 * @param {Function} onResult - called with the raw QR string
 * @param {Function} onError  - called with an Error
 * @returns {Promise<void>}
 */
export async function startCameraScanning(videoEl, canvasEl, deviceId, onResult, onError) {
  await stopCameraScanning();

  const constraints = {
    video: {
      facingMode: 'environment',
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      width:  { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  };

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    const friendly = cameraPermissionError(err);
    onError(new Error(friendly));
    return;
  }

  videoEl.srcObject = cameraStream;

  await new Promise((resolve, reject) => {
    videoEl.onloadedmetadata = () => {
      videoEl.play().then(resolve).catch(reject);
    };
    videoEl.onerror = reject;
    setTimeout(() => reject(new Error('Video load timeout')), 8000);
  });

  onResultCb = onResult;
  isScanning = true;

  scanInterval = setInterval(() => {
    if (!isScanning) return;
    const result = scanVideoFrame(videoEl, canvasEl);
    if (result) {
      onResultCb(result);
    }
  }, SCAN_INTERVAL_MS);
}

/**
 * Stop camera scanning and release the stream.
 */
export async function stopCameraScanning() {
  isScanning = false;

  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
}

/**
 * Scan a single video frame for a QR code.
 * @param {HTMLVideoElement} videoEl
 * @param {HTMLCanvasElement} canvasEl
 * @returns {string|null}
 */
export function scanVideoFrame(videoEl, canvasEl) {
  if (videoEl.readyState < videoEl.HAVE_ENOUGH_DATA) return null;
  if (!window.jsQR) return null;

  const { videoWidth: w, videoHeight: h } = videoEl;
  if (!w || !h) return null;

  canvasEl.width  = w;
  canvasEl.height = h;

  const ctx = canvasEl.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(videoEl, 0, 0, w, h);

  let imageData;
  try {
    imageData = ctx.getImageData(0, 0, w, h);
  } catch {
    return null;
  }

  const code = window.jsQR(imageData.data, w, h, {
    inversionAttempts: 'dontInvert',
  });

  return code?.data ?? null;
}

/**
 * Get available camera devices.
 * @returns {Promise<MediaDeviceInfo[]>}
 */
export async function getCameraDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d => d.kind === 'videoinput');
  } catch {
    return [];
  }
}

// ---- Image scanning ----------------------------------------------

/**
 * Decode a QR code from a File object.
 * @param {File} file
 * @returns {Promise<string>}  Resolves with the QR data string
 */
export async function decodeQRFromFile(file) {
  validateImageFile(file);

  const dataUrl = await fileToDataUrl(file);
  return decodeQRFromDataUrl(dataUrl);
}

/**
 * Decode a QR code from an image data URL.
 * @param {string} dataUrl
 * @returns {Promise<string>}
 */
export async function decodeQRFromDataUrl(dataUrl) {
  if (!window.jsQR) {
    throw new Error('QR decoding library not loaded. Please refresh the page.');
  }

  const img = await loadImage(dataUrl);

  // Try multiple scales for small/large QR codes
  const scales = [1, 0.75, 0.5, 1.5];

  for (const scale of scales) {
    const result = tryDecodeAtScale(img, scale);
    if (result) return result;
  }

  throw new Error('No QR code found in the image. Ensure the QR code is clearly visible and not obscured.');
}

/**
 * Attempt to decode a QR code from an image at a given scale.
 * @param {HTMLImageElement} img
 * @param {number} scale
 * @returns {string|null}
 */
function tryDecodeAtScale(img, scale) {
  const canvas = document.createElement('canvas');
  const w = Math.round(img.naturalWidth  * scale);
  const h = Math.round(img.naturalHeight * scale);

  // Safety: don't decode tiny or absurdly large images
  if (w < 10 || h < 10 || w > 8192 || h > 8192) return null;

  canvas.width  = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);

  let imageData;
  try {
    imageData = ctx.getImageData(0, 0, w, h);
  } catch {
    return null;
  }

  const result = window.jsQR(imageData.data, w, h, {
    inversionAttempts: 'attemptBoth',
  });

  return result?.data ?? null;
}

// ---- Helpers & validation ----------------------------------------

/**
 * @param {File} file
 */
function validateImageFile(file) {
  if (!file) throw new Error('No file provided.');

  const MAX_SIZE = 20 * 1024 * 1024; // 20MB
  if (file.size > MAX_SIZE) {
    throw new Error('File is too large (max 20MB). Please use a smaller image.');
  }

  const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif',
                        'image/bmp', 'image/webp', 'image/tiff', 'image/svg+xml'];
  if (!allowedTypes.includes(file.type) && !file.type.startsWith('image/')) {
    throw new Error(`Unsupported file type: ${file.type}. Please use PNG, JPG, GIF, BMP, or WebP.`);
  }
}

/**
 * Map MediaDevices errors to user-friendly messages.
 * @param {Error} err
 * @returns {string}
 */
function cameraPermissionError(err) {
  switch (err.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Camera access was denied. Please allow camera permission in your browser settings and try again.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera was found on this device.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'Camera is already in use by another application.';
    case 'OverconstrainedError':
      return 'Could not access the requested camera. Please try a different camera.';
    case 'TypeError':
      return 'Camera access requires a secure context (HTTPS). Please use a secure connection.';
    default:
      return `Camera error: ${err.message}`;
  }
}

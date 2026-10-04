import path from 'path';

const BLOCKED_EXTENSIONS = new Set([
  'exe',
  'dll',
  'bat',
  'cmd',
  'sh',
  'js',
  'mjs',
  'html',
  'htm',
  'svg',
  'php',
  'jar',
  'msi',
  'ps1',
  'vbs',
  'com',
  'scr',
  'cgi',
  'pl',
  'py',
]);

const ALLOWED_EXTENSIONS = new Set([
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'txt',
  'csv',
  'md',
  'json',
  'docx',
  'xlsx',
  'pptx',
  'zip',
]);

export interface SanitizedFilename {
  originalName: string;
  sanitizedName: string;
  extension: string;
}

/**
 * Sanitizes a filename:
 * - Unicode NFC normalization
 * - Strips directory traversal (../, ..\, null bytes)
 * - Strips control characters
 * - Collapses spaces
 * - Truncates to max 255 chars
 */
export function sanitizeFilename(rawName: string): SanitizedFilename {
  if (!rawName || typeof rawName !== 'string') {
    throw new Error('Filename must be a non-empty string');
  }

  // 1. Unicode NFC normalization
  let clean = rawName.normalize('NFC');

  // 2. Remove null bytes and control characters (0-31, 127)
  clean = clean.replace(/[\x00-\x1F\x7F]/g, '');

  // 3. Remove leading path separators / directory traversal
  clean = clean.replace(/^[./\\]+/, '');
  clean = path.basename(clean);

  // 4. Collapse spaces
  clean = clean.replace(/\s+/g, ' ').trim();

  // 5. Max 255 chars
  if (clean.length > 255) {
    const ext = path.extname(clean);
    clean = clean.substring(0, 255 - ext.length) + ext;
  }

  if (!clean || clean === '.' || clean === '..') {
    throw new Error('Filename sanitizes to empty or invalid name');
  }

  // 6. Double extension check
  const parts = clean.split('.');
  if (parts.length > 2) {
    // Check if any intermediate part looks like an executable/blocked extension
    for (let i = 1; i < parts.length - 1; i++) {
      const part = parts[i].toLowerCase();
      if (BLOCKED_EXTENSIONS.has(part)) {
        throw new Error(`Suspicious double extension detected: .${part}`);
      }
    }
  }

  const ext = path.extname(clean).replace(/^\./, '').toLowerCase();

  if (!ext) {
    throw new Error('File must have an extension');
  }

  if (BLOCKED_EXTENSIONS.has(ext)) {
    throw new Error(`File extension .${ext} is strictly prohibited`);
  }

  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`File extension .${ext} is not allowed`);
  }

  return {
    originalName: rawName,
    sanitizedName: clean,
    extension: ext,
  };
}

/**
 * Encodes filename for RFC 5987 Content-Disposition header.
 * Prevents HTTP header injection, CRLF, and quote escaping attacks.
 */
export function encodeRFC5987(filename: string): string {
  return encodeURIComponent(filename)
    .replace(/['()]/g, escape)
    .replace(/\*/g, '%2A');
}

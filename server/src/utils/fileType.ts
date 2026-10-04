
const TEXT_EXTENSIONS = new Set(['txt', 'csv', 'md', 'json']);

const EXTENSION_MIME_MAP: Record<string, string[]> = {
  pdf: ['application/pdf'],
  png: ['image/png'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  webp: ['image/webp'],
  gif: ['image/gif'],
  zip: ['application/zip', 'application/x-zip-compressed'],
  docx: [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/zip',
  ],
  xlsx: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip',
  ],
  pptx: [
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip',
  ],
};

export interface FileValidationResult {
  detectedMime: string;
  detectedExt?: string;
}

/**
 * Validates magic bytes of an uploaded file against its declared extension.
 * Rejects disguised executables, scripts, stored XSS payloads, and malformed files.
 */
export async function validateFileContent(
  buffer: Buffer,
  declaredExtension: string
): Promise<FileValidationResult> {
  const ext = declaredExtension.toLowerCase();

  // 1. Text-based files (no magic bytes)
  if (TEXT_EXTENSIONS.has(ext)) {
    // Check first 4KB for null bytes (indicators of binary executable disguised as text)
    const inspectLength = Math.min(buffer.length, 4096);
    for (let i = 0; i < inspectLength; i++) {
      if (buffer[i] === 0) {
        throw new Error('Text file contains null bytes, binary content disguised as text is forbidden');
      }
    }

    // Verify valid UTF-8 encoding
    const textSample = buffer.toString('utf8');
    if (textSample.includes('\uFFFD') && buffer.length > 0) {
      // Replacement character indicates invalid UTF-8 sequence
      throw new Error('Text file contains invalid UTF-8 byte sequences');
    }

    let mime = 'text/plain';
    if (ext === 'json') {
      try {
        JSON.parse(textSample);
        mime = 'application/json';
      } catch {
        throw new Error('File with .json extension must contain valid JSON syntax');
      }
    } else if (ext === 'csv') {
      mime = 'text/csv';
    } else if (ext === 'md') {
      mime = 'text/markdown';
    }

    return { detectedMime: mime, detectedExt: ext };
  }

  // 2. Binary files - inspect magic bytes
  const { fileTypeFromBuffer } = await import('file-type');
  const typeResult = await fileTypeFromBuffer(buffer);

  if (!typeResult) {
    throw new Error(`Unable to determine binary file type from magic bytes for .${ext} file`);
  }

  // Check if detected type is dangerous (SVG, HTML, Executable, ELF, etc.)
  const dangerousMimes = [
    'image/svg+xml',
    'text/html',
    'application/x-msdownload',
    'application/x-executable',
    'application/x-sh',
    'application/javascript',
  ];

  if (dangerousMimes.includes(typeResult.mime)) {
    throw new Error(`Forbidden file content detected: ${typeResult.mime}`);
  }

  // Validate declared extension against detected magic bytes
  const allowedMimes = EXTENSION_MIME_MAP[ext];
  if (!allowedMimes || !allowedMimes.includes(typeResult.mime)) {
    throw new Error(
      `File signature mismatch: declared .${ext} but magic bytes indicate ${typeResult.mime} (.${typeResult.ext})`
    );
  }

  return {
    detectedMime: typeResult.mime,
    detectedExt: typeResult.ext,
  };
}

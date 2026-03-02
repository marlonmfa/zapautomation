/**
 * Loads knowledge text from a PDF file for use in the first-contact AI prompt.
 * Text is cached in memory after first load.
 */

const fs = require('fs').promises;
const path = require('path');

let cachedText = null;
let cachedPath = null;

/**
 * Extracts text from a PDF file path.
 * @param {string} pdfPath - Absolute or relative path to the PDF file
 * @returns {Promise<string>} Extracted text, or empty string on error
 */
async function loadKnowledgeFromPdf(pdfPath) {
  if (!pdfPath || typeof pdfPath !== 'string') return '';
  const resolved = path.isAbsolute(pdfPath) ? pdfPath : path.resolve(process.cwd(), pdfPath);

  if (cachedPath === resolved && cachedText !== null) {
    return cachedText;
  }

  try {
    const buffer = await fs.readFile(resolved);
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    await parser.destroy();
    const text = (result && result.text) ? String(result.text).trim() : '';
    cachedPath = resolved;
    cachedText = text;
    return text;
  } catch (err) {
    console.error('[knowledge-from-pdf] Failed to load PDF:', resolved, err.message);
    return '';
  }
}

/**
 * Returns cached knowledge text if path matches, or empty string.
 * Does not read from disk.
 * @param {string} pdfPath - Path that was used to load (for cache key)
 * @returns {string}
 */
function getCachedKnowledge(pdfPath) {
  if (!pdfPath || cachedPath !== path.resolve(process.cwd(), pdfPath)) return '';
  return cachedText || '';
}

/**
 * Clears the in-memory cache (e.g. after updating the PDF).
 */
function clearCache() {
  cachedText = null;
  cachedPath = null;
}

module.exports = {
  loadKnowledgeFromPdf,
  getCachedKnowledge,
  clearCache,
};

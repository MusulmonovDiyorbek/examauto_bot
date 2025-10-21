// src/controllers/fileController.js
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const Tesseract = require('tesseract.js');
const fetch = require('node-fetch');

/**
 * Faylni URL orqali yuklab olish va o‘qish
 * PDF bo‘lsa — pdf-parse orqali
 * Rasm bo‘lsa — Tesseract (OCR)
 */
async function processFileFromUrl(fileUrl, saveAs) {
  const res = await fetch(fileUrl);
  const buffer = await res.arrayBuffer();
  const buf = Buffer.from(buffer);
  const ext = path.extname(saveAs).toLowerCase();

  if (ext === '.pdf') {
    const data = await pdf(buf);
    return { text: data.text };
  } else {
    const { data: { text } } = await Tesseract.recognize(buf, 'eng');
    return { text };
  }
}

module.exports = { processFileFromUrl };

// src/utils/textParser.js
function extractQuestions(text) {
  if (!text) return [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const questions = [];

  for (let line of lines) {
    if (/^\d+[\).]/.test(line) || line.endsWith('?')) {
      questions.push(line);
    }
  }
  return questions;
}

module.exports = { extractQuestions };

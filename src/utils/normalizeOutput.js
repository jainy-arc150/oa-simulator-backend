// Spec 5.2: the one normalization applied to both the student's stdout and the expected output.
// 1. CRLF and old Mac CR become LF. 2. Split into lines. 3. Remove spaces and tabs at the end of
// each line. 4. Remove empty lines at the end. 5. Join with LF.
function normalizeOutput(text) {
  const lines = String(text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''));
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

module.exports = normalizeOutput;

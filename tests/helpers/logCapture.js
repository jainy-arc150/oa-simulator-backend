const { Writable } = require('stream');

// Collects pino output so tests can read the JSON log lines.
function createLogCapture() {
  const lines = [];
  const stream = new Writable({
    write(chunk, encoding, callback) {
      chunk
        .toString()
        .split('\n')
        .filter(Boolean)
        .forEach((line) => lines.push(JSON.parse(line)));
      callback();
    },
  });
  return { stream, lines };
}

module.exports = { createLogCapture };

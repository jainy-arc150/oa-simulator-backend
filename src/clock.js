// Section 6.7: Every timestamp comes from this function
// Replaceable in tests with a fake clock

function now() {
  return new Date();
}

module.exports = { now };

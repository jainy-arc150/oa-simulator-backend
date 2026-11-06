const clock = require('../../src/clock');

// Replaces clock.now() with a time the test controls. Call restore() when done.
function useFakeClock(start = new Date('2030-01-01T00:00:00.000Z')) {
  let current = start.getTime();
  const spy = jest.spyOn(clock, 'now').mockImplementation(() => new Date(current));
  return {
    set(date) {
      current = date.getTime();
    },
    advance(ms) {
      current += ms;
    },
    restore() {
      spy.mockRestore();
    },
  };
}

module.exports = { useFakeClock };

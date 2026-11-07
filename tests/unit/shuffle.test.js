const shuffle = require('../../src/utils/shuffle');

afterEach(() => jest.restoreAllMocks());

describe('shuffle (spec 5.4 step 5, D39: Fisher-Yates)', () => {
  test('returns the same items in some order and leaves the input unchanged', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const result = shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(result).not.toBe(input);
    expect([...result].sort((a, b) => a - b)).toEqual(input);
  });

  test('handles an empty array and a single item', () => {
    expect(shuffle([])).toEqual([]);
    expect(shuffle(['only'])).toEqual(['only']);
  });

  test('swaps from the end with a random earlier position (Fisher-Yates order)', () => {
    // With random() always 0, every step swaps position i with position 0:
    // [1,2,3,4] -> [4,2,3,1] -> [3,2,4,1] -> [2,3,4,1]
    jest.spyOn(Math, 'random').mockReturnValue(0);
    expect(shuffle([1, 2, 3, 4])).toEqual([2, 3, 4, 1]);

    // With random() just below 1, every position swaps with itself.
    Math.random.mockReturnValue(0.999999);
    expect(shuffle([1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
  });

  test('every order of three items comes out about equally often', () => {
    const runs = 6000;
    const counts = new Map();
    for (let i = 0; i < runs; i++) {
      const key = shuffle(['a', 'b', 'c']).join('');
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual(['abc', 'acb', 'bac', 'bca', 'cab', 'cba']);
    // Expected 1000 each; the standard deviation is about 29, so 850..1150 is over 5 deviations away.
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(850);
      expect(count).toBeLessThan(1150);
    }
  });
});

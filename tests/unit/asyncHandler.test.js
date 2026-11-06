const asyncHandler = require('../../src/utils/asyncHandler');

describe('asyncHandler (spec 6.3)', () => {
  test('passes a rejected promise to next instead of leaving it unhandled', async () => {
    const error = new Error('boom');
    const next = jest.fn();
    asyncHandler(async () => {
      throw error;
    })({}, {}, next);
    await new Promise((resolve) => setImmediate(resolve));
    expect(next).toHaveBeenCalledWith(error);
  });

  test('passes a synchronous throw to next', async () => {
    const error = new Error('sync boom');
    const next = jest.fn();
    asyncHandler(() => {
      throw error;
    })({}, {}, next);
    await new Promise((resolve) => setImmediate(resolve));
    expect(next).toHaveBeenCalledWith(error);
  });

  test('does not call next when the handler succeeds', async () => {
    const next = jest.fn();
    asyncHandler(async () => 'ok')({}, {}, next);
    await new Promise((resolve) => setImmediate(resolve));
    expect(next).not.toHaveBeenCalled();
  });
});

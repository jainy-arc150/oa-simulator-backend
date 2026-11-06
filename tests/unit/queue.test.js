const { createQueue } = require('../../src/runner/queue');
const RunnerUnavailableError = require('../../src/errors/RunnerUnavailableError');

// A task that finishes only when the test says so.
function controlledTask() {
  let finish;
  let started = false;
  const promise = new Promise((resolve) => {
    finish = resolve;
  });
  return { task: () => ((started = true), promise), finish, get started() { return started; } };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('runner queue (spec 5.1)', () => {
  test('runs at most `concurrency` tasks at once and the rest wait', async () => {
    const queue = createQueue({ concurrency: 2, maxWaiting: 10 });
    const tasks = [controlledTask(), controlledTask(), controlledTask(), controlledTask()];
    const results = tasks.map((t) => queue.run(t.task));
    await tick();
    expect(tasks.map((t) => t.started)).toEqual([true, true, false, false]);
    expect(queue.running).toBe(2);
    expect(queue.waiting).toBe(2);

    tasks[0].finish('a');
    await tick();
    expect(tasks.map((t) => t.started)).toEqual([true, true, true, false]);
    tasks[1].finish('b');
    tasks[2].finish('c');
    tasks[3].finish('d');
    expect(await Promise.all(results)).toEqual(['a', 'b', 'c', 'd']);
    expect(queue.running).toBe(0);
    expect(queue.waiting).toBe(0);
  });

  test('waiting tasks start in the order they arrived', async () => {
    const queue = createQueue({ concurrency: 1, maxWaiting: 10 });
    const order = [];
    const first = controlledTask();
    const all = [queue.run(first.task)];
    for (const name of ['b', 'c', 'd']) all.push(queue.run(async () => order.push(name)));
    first.finish();
    await Promise.all(all);
    expect(order).toEqual(['b', 'c', 'd']);
  });

  test('refuses a new task with RunnerUnavailableError when `maxWaiting` tasks are already waiting', async () => {
    const queue = createQueue({ concurrency: 1, maxWaiting: 2 });
    const running = controlledTask();
    const accepted = [queue.run(running.task), queue.run(controlledTask().task), queue.run(controlledTask().task)];
    await tick();
    expect(queue.waiting).toBe(2);
    await expect(queue.run(async () => 'late')).rejects.toBeInstanceOf(RunnerUnavailableError);
    expect(queue.waiting).toBe(2);
    running.finish();
    await accepted[0];
  });

  test('exactly `maxWaiting` waiting tasks are accepted, the next one is refused', async () => {
    const queue = createQueue({ concurrency: 2, maxWaiting: 10 });
    const outcomes = [];
    const gate = controlledTask();
    for (let i = 0; i < 13; i++) outcomes.push(queue.run(gate.task).then(() => 'ran', (e) => e.name));
    await tick();
    expect(queue.running).toBe(2);
    expect(queue.waiting).toBe(10);
    expect(await Promise.race([outcomes[12], Promise.resolve('pending')])).toBe('RunnerUnavailableError');
    gate.finish();
    const settled = await Promise.all(outcomes);
    expect(settled.filter((s) => s === 'ran')).toHaveLength(12);
  });

  test('a failing task frees its slot and its error reaches the caller', async () => {
    const queue = createQueue({ concurrency: 1, maxWaiting: 10 });
    const failing = queue.run(async () => {
      throw new Error('task failed');
    });
    const after = queue.run(async () => 'next one runs');
    await expect(failing).rejects.toThrow('task failed');
    await expect(after).resolves.toBe('next one runs');
    expect(queue.running).toBe(0);
  });

  test('a task that throws synchronously also frees its slot', async () => {
    const queue = createQueue({ concurrency: 1, maxWaiting: 10 });
    const failing = queue.run(() => {
      throw new Error('sync failure');
    });
    const after = queue.run(async () => 'ok');
    await expect(failing).rejects.toThrow('sync failure');
    await expect(after).resolves.toBe('ok');
  });

  test('rejectWaiting rejects tasks that have not started and leaves running ones alone', async () => {
    const queue = createQueue({ concurrency: 1, maxWaiting: 10 });
    const running = controlledTask();
    const first = queue.run(running.task);
    const waiting = queue.run(async () => 'never');
    await tick();
    queue.rejectWaiting(new RunnerUnavailableError('shutting down'));
    await expect(waiting).rejects.toThrow('shutting down');
    running.finish('still fine');
    await expect(first).resolves.toBe('still fine');
  });
});

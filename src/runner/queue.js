const RunnerUnavailableError = require('../errors/RunnerUnavailableError');

// At most `concurrency` tasks run at once; the rest wait in order. When `maxWaiting` tasks are
// already waiting, a new task is refused with RunnerUnavailableError (spec 5.1).
function createQueue({ concurrency, maxWaiting }) {
  let running = 0;
  const waiting = [];

  function startWaiting() {
    while (running < concurrency && waiting.length > 0) {
      const { task, resolve, reject } = waiting.shift();
      running += 1;
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          running -= 1;
          startWaiting();
        });
    }
  }

  function run(task) {
    return new Promise((resolve, reject) => {
      if (running >= concurrency && waiting.length >= maxWaiting) {
        reject(new RunnerUnavailableError('The runner queue is full'));
        return;
      }
      waiting.push({ task, resolve, reject });
      startWaiting();
    });
  }

  // Rejects every task that has not started. Tasks already running are left alone.
  function rejectWaiting(error) {
    waiting.splice(0).forEach(({ reject }) => reject(error));
  }

  return {
    run,
    rejectWaiting,
    get running() {
      return running;
    },
    get waiting() {
      return waiting.length;
    },
  };
}

module.exports = { createQueue };

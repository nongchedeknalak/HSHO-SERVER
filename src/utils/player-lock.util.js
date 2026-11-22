// Runs async tasks one at a time per key (usually a steamId), so two quick requests
// (double-click on buy, opening gacha twice) cannot overwrite each other's inventory writes.
const locks = new Map();

async function withPlayerLock(key, task) {
  const previous = locks.get(key) || Promise.resolve();
  const run = previous.catch(() => {}).then(task);
  const tail = run.catch(() => {});

  locks.set(key, tail);
  tail.then(() => {
    if (locks.get(key) === tail) {
      locks.delete(key);
    }
  });

  return run;
}

module.exports = { withPlayerLock };

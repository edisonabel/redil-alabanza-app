let timerID = null;
let interval = 25;

const startWorker = () => {
  if (timerID !== null) {
    clearInterval(timerID);
  }

  timerID = setInterval(() => {
    postMessage('tick');
  }, interval);
};

self.onmessage = function onMessage(event) {
  if (event.data === 'start') {
    startWorker();
    return;
  }

  if (event.data === 'stop') {
    if (timerID !== null) {
      clearInterval(timerID);
      timerID = null;
    }
    return;
  }

  if (event.data && typeof event.data.interval === 'number') {
    interval = event.data.interval;
    if (timerID !== null) {
      startWorker();
    }
  }
};

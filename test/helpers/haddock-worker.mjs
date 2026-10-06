import { parentPort } from 'node:worker_threads';
import { executeHaddock } from '../../shell/haddock-worker.js';
parentPort.on('message', options => executeHaddock(options, data => parentPort.postMessage(data))
  .catch(error => parentPort.postMessage({ type: 'exit', code: 1, error: error.message })));

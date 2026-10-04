import { parentPort } from 'node:worker_threads';
import { executeProcess } from '../../shell/process-worker.js';
parentPort.on('message', options => executeProcess(options, data => parentPort.postMessage(data)));

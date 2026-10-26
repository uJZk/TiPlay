import { Worker as Thread } from 'node:worker_threads';
export class SoftwareWorker {
  constructor() {
    const source = `import {parentPort,workerData} from 'node:worker_threads';
      globalThis.self={postMessage:(data,transfer)=>parentPort.postMessage(data,transfer)};
      await import(workerData);parentPort.on('message',data=>self.onmessage({data}));`;
    this.thread = new Thread(new URL('data:text/javascript,' + encodeURIComponent(source)), {
      workerData: new URL('../../site/play/airplay-libav-worker.js', import.meta.url).href,
    });
    this.thread.on('message', data => this.onmessage?.({ data }));
    this.thread.on('error', error => this.onerror?.(error));
  }
  postMessage(data, transfer = []) { this.thread.postMessage(data, transfer); }
  terminate() { void this.thread.terminate(); }
}

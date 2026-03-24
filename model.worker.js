// model.worker.js — ES Module Worker

import { pipeline, env } from './transformers.min.js';

env.allowRemoteModels = true;
env.allowLocalModels  = false;
env.useBrowserCache   = true;

const MODEL_NAME     = 'Xenova/TinyLlama-1.1B-Chat-v1.0';
const MAX_NEW_TOKENS = 256;

let generator = null;

async function loadModel() {
  try {
    generator = await pipeline('text-generation', MODEL_NAME, {
      dtype: 'q4',
      progress_callback: (p) => self.postMessage({ type: 'progress', payload: p }),
    });
    self.postMessage({ type: 'ready' });
  } catch (err) {
    self.postMessage({ type: 'error', payload: err.message });
  }
}

async function generate({ prompt, id }) {
  try {
    const out = await generator(prompt, {
      max_new_tokens: MAX_NEW_TOKENS,
      do_sample: true,
      temperature: 0.7,
      top_p: 0.9,
      repetition_penalty: 1.1,
    });
    self.postMessage({ type: 'result', id, payload: out[0].generated_text });
  } catch (err) {
    self.postMessage({ type: 'gen_error', id, payload: err.message });
  }
}

self.addEventListener('message', (e) => {
  if (e.data.type === 'load')     loadModel();
  if (e.data.type === 'generate') generate(e.data);
});

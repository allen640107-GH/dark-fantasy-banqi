import { findBestActionPro } from './aiEngine.js';

self.onmessage = (e) => {
  const { gameState, config } = e.data;
  const action = findBestActionPro(gameState, config);
  self.postMessage(action);
};

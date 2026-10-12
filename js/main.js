import { App } from './app.js';

const app = new App(document.getElementById('app'));
window.pdn = app; // handy for debugging
app.start().catch((e) => console.error(e));

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

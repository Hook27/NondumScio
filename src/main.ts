// Startpunt van de app. De echte inhoud volgt in latere PR's; dit bewijst dat
// de keten (TypeScript, bundelen, uitrollen) werkt.
const app = document.querySelector<HTMLElement>('#app');
if (app) {
  app.dataset.ready = 'true';
}

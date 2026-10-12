// An installed extension's index.js must default-export the manifest. Tests
// import server/manifest.js directly, never this file.
export { default, dir } from './server/manifest.js';

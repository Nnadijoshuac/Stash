// esbuild injects this into the web bundle so web3.js finds Buffer, as it
// does in Node and in the Android app's polyfill.
export { Buffer } from 'buffer'

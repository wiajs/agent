import http from 'node:http';
import https from 'node:https';
import HttpsAgent from './httpsAgent.js';
import HttpAgent from './httpAgent.js';

/** @typedef {import('./tunnel').Proxy} Proxy */
/** @typedef {http.AgentOptions & https.AgentOptions & {proxy: string|Proxy, proxyOpts?: *, tunnel?: boolean}} AgentOpts */

export default class Agent {
  /**
   * @param {AgentOpts} options
   */
  constructor(options) {
    const httpOpt = {tunnel: false, ...options};
    this.http = new HttpAgent(httpOpt);
    const httpsOpt = {...options, tunnel: true};
    this.https = new HttpsAgent(httpsOpt);
  }
}

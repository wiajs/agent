export type Proxy = import("./tunnel.js").Proxy;
export type AgentOpts = http.AgentOptions & https.AgentOptions & {
    proxy: string | Proxy;
    proxyOpts?: any;
    tunnel?: boolean;
};
export class Agent {
    constructor(options: AgentOpts);
    http: HttpAgent;
    https: HttpsAgent;
}
import HttpAgent from './httpAgent.js';
import HttpsAgent from './httpsAgent.js';
import http from 'node:http';
import https from 'node:https';
export { HttpAgent, HttpsAgent };

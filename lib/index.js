import http from 'http';
import https from 'https';
import HttpAgent from './httpAgent.js';
import HttpsAgent from './httpsAgent.js';
/** @typedef {import('./tunnel.js').Proxy} Proxy */ /** @typedef {http.AgentOptions & https.AgentOptions & {proxy: string|Proxy, proxyOpts?: *, tunnel?: boolean}} AgentOpts */ // export default 和 named 混合包转换为cjs后，将缺省变成default，cjs require时，需带default
// 被其他库引用时，需设置 interop: 'auto', 自动生成适配 default 和 named
// 因此，不推荐混合包
/**
 * 同时生成HttpAgent 和 HttpsAgent 代理，自动设置 tunnel（隧道）
 * 仅在代理协议、目标协议均为 http时，不走 tunnel（隧道），使用简单的数据透明转发（不安全）
 * 需注意：Http、Https 针对目标服务器访问协议，而不是代理服务器的代理协议
 * 代理服务器支持 http、socks协议，socks协议时，无论http、https，都走tunnel（隧道）
 */ let Agent = class Agent {
    /**
   * @param {AgentOpts} options
   */ constructor(options){
        const httpOpt = {
            tunnel: false,
            ...options
        };
        this.http = new HttpAgent(httpOpt);
        const httpsOpt = {
            ...options,
            tunnel: true
        };
        this.https = new HttpsAgent(httpsOpt);
    }
};
export { Agent, HttpAgent, HttpsAgent };

import { log as Log, name } from '@wiajs/log';
import http from 'http';
import https from 'https';
import { connect, parseURL, socksConnect } from './tunnel.js';
const log = Log({
    env: `wia:agent:${name(import.meta.url)}`
});
let HttpsAgent = class HttpsAgent extends https.Agent {
    /**
   * [新增] 显式重写 addRequest
   * 作用：
   * 1. 确认 https.request 是否真的使用了这个 Agent
   * 2. 确保将合并后的参数传递给父类，防止父类因缺少参数而不调用 createConnection
   * @param {*} req
   * @param {AgentConnectOpts} opts
   */ addRequest(req, opts) {
        // 调试日志：确认 Agent 入口被调用
        // console.log('HttpsAgent addRequest called', { optsHost: opts.host, optsPort: opts.port })
        log({
            opts
        }, 'HttpsAgent addRequest');
        const _ = this;
        // 关键：在这里合并配置，确保 rejectUnauthorized 等安全配置传入底层逻辑
        // 虽然 createConnection 里也合并了，但 addRequest 里的合并能影响连接池 Key 的生成
        const combinedOpts = {
            ..._.opt,
            ...opts
        };
        // 如果设置了代理，且非隧道模式（虽然 HttpsAgent 主要是隧道），可以在这里像 HttpAgent 一样处理 Header
        // 但对于 HttpsAgent，最重要的是确保 super.addRequest 被正确调用
        // @ts-ignore
        return super.addRequest(req, combinedOpts);
    }
    /**
   * 默认情况下，此函数与 net.createConnection() 相同。
   * 但是，如需要更大的灵活性，自定义代理可以覆盖此方法。
   * 可以通过以下两种方式之一提供套接字/流：通过从此函数返回套接字/流，或通过将套接字/流传递给回调。
   * 除非用户指定 <net.Socket> 以外的套接字类型，否则此方法保证返回 <net.Socket> 类（<stream.Duplex> 的子类）的实例。
   * 实现proxy 代理，需要重写该方法。
   * @param {AgentConnectOpts} opts
   * @param {(err: Error | null, s?: Duplex) => void} cb
   * cb(err, stream) 返回 连接socket
   */ createConnection(opts, cb) {
        console.log('HttpsAgent createConnection called') // 调试日志
        ;
        const _ = this;
        const { proxy, proxyOpts } = _;
        let { opt } = _;
        console.log({
            opt,
            opts,
            proxy,
            proxyOpts
        }, 'createConnection');
        if (!proxy) {
            // [FIX] 关键修复：合并 this.opt (包含 rejectUnauthorized) 与当前请求 opts
            // opts 中的 host/port 会覆盖 this.opt 中的默认值，但安全配置会保留
            opt = {
                ...opt,
                ...opts
            };
            // @ts-ignore
            const socket = super.createConnection(opt);
            socket.once('connect', ()=>{
                log('Create Https Socket Success.');
                cb(null, socket);
            });
            // 建议：如果不需要特定的 connect 监听，也可以直接返回 socket，遵循标准 Agent 行为
            // 但为了保持原有逻辑风格，此处保留。
            // 注意：处理一下 error 事件，防止 TLS 握手失败（如证书错误）时无响应
            socket.once('error', (err)=>{
                // 防止 uncaughtException，虽然外部 request 也会监听，但在此处处理更稳健
                log.err(err, 'Https Socket Error');
            });
            socket.once('close', ()=>log('Https Socket close.'));
            // 必须返回 socket 实例（虽然使用了 cb，但标准接口通常也期望返回 socket）
            return socket;
        } else {
            // 代理模式逻辑
            if ([
                'http:',
                'https:'
            ].includes(proxy.protocol)) {
                Promise.resolve().then(()=>connect(opts, proxy, proxyOpts))// @ts-ignore
                .then(({ socket, err })=>{
                    if (socket && opts.protocol === 'https:') {
                        // [FIX] 关键修复：代理建立后的 TLS 握手同样需要合并 this.opt
                        // @ts-ignore
                        const secureSocket = super.createConnection({
                            ...this.opt,
                            ...opts,
                            socket
                        });
                        if (secureSocket) {
                            secureSocket == null ? void 0 : secureSocket.once('close', ()=>log('Secure Socket close.'));
                            log('Create Secure Socket Success.');
                            cb(null, secureSocket);
                        } else log.error('Create Secure Socket Fail.');
                    } else if (err) cb(err, null);
                }).catch((err)=>{
                    log.err(err);
                    cb(err);
                });
            } else {
                Promise.resolve().then(()=>socksConnect(opts, proxy, this.lookup)).then((socket)=>{
                    if (socket && opts.protocol === 'https:') {
                        // [FIX] 关键修复：SOCKS 代理后的 TLS 握手同样需要合并 this.opt
                        // @ts-ignore
                        const secureSocket = super.createConnection({
                            ...this.opt,
                            ...opts,
                            socket
                        });
                        if (secureSocket) {
                            log('Created secureSocket Success.');
                            cb(null, secureSocket);
                        } else log.error('Creat secureSocket Fail.');
                    }
                }).catch((err)=>{
                    log.err(err, 'createConnection');
                    cb(err);
                });
            }
        }
    }
    /**
   * @param {AgentOpts} opts
   */ constructor(opts){
        const { proxy, proxyOpts, ...opt } = opts;
        super(opt);
        if (opt.timeout) this.timeout = opt.timeout // super(opt) 无效
        ;
        // 保存构造函数参数，包含 rejectUnauthorized 等关键 TLS 配置
        this.opt = opt;
        // console.error({opt}, 'HttpsAgent Constructor')
        let lookup = false;
        /** @type {Proxy} */ let px;
        if (typeof proxy === 'string') // let proxy = `http://${username}:${password}@${proxy_ip}:${proxy_port}`
        // let proxy = `socks5h://${username}:${password}@${proxy_ip}:${proxy_port}`
        ({ proxy: px, lookup } = parseURL(new URL(proxy)));
        else px = proxy;
        this.lookup = lookup;
        if (px) {
            // Trim off the brackets from IPv6 addresses
            px.host = px.host.replace(/^\[|\]$/g, '');
            if (!px.port) {
                if (px.protocol === 'https:') px.port = 443;
                else if (px.protocol === 'http:') px.port = 80;
                else px.port = 1080;
            }
            this.proxy = px;
            this.proxyOpts = proxyOpts || {};
            this.tunnel = true;
            log({
                proxy: px,
                proxyOpts,
                tunnel: true
            }, 'Create HttpsAgent');
        }
    }
};
HttpsAgent.protocols = [
    'http',
    'https',
    'socks',
    'socks4',
    'socks4a',
    'socks5',
    'socks5h'
];
/** @typedef {import('stream').Duplex} Duplex */ /** @typedef {import('./tunnel').AgentConnectOpts} AgentConnectOpts */ /** @typedef {import('./tunnel').Proxy} Proxy */ /** @typedef {http.AgentOptions & https.AgentOptions & {proxy?: string|Proxy, proxyOpts?: *, tunnel?: boolean}} AgentOpts */ /**
 * 目标网址HTTPS访问代理，支持http、https、socks、socks5, socks5h
 * 转发不安全，推荐使用隧道
 * 重写 https.Agent的createConnection
 * 使用 HTTP 1.1 CONNECT 协议，通过http或https连接代理服务器，建立TLS隧道，
 */ export { HttpsAgent as default };

import http from 'node:http';
import https from 'node:https';
import * as net from 'node:net';
import * as tls from 'node:tls';
import { log as Log, name } from '@wiajs/log';
import { connect, socksConnect, parseURL, omit } from './tunnel.js';
const log = Log({
    env: `wia:agent:${name(__filename)}`
});
/** @typedef {import('stream').Duplex} Duplex */ /** @typedef {import('./tunnel').AgentConnectOpts & {hostname?: string, path?: string, pathname?: string, keepAlive: boolean}} AgentConnectOpts */ /** @typedef {import('./tunnel').Proxy} Proxy */ /** @typedef {http.AgentOptions & https.AgentOptions & {proxy: string|Proxy, proxyOpts?: *, tunnel?: boolean}} AgentOpts */ /**
 * 目的网址为http的转发或隧道代理
 * 转发：由代理服务器访问目的网址，将结果返回，代理服务器能获得所有内容，不安全
 * http 通过 tunnel = true 支持隧道，由于http本身明文，隧道也不安全，比转发稍微安全而已
 * https 请使用 httpsAgent
 * 代理服务器http或https均支持，https安全，但代理效率低
 * 重写 http.Agent的addRequest
 *  host    : proxyIp, // 替换为代理地址
    port    : proxyPort, // 替换为代理端口
    path    : targetUrl, // 目的网址
    method  : "GET",
    headers : {
        "Host"                : urlParsed.hostname,
        "Proxy-Authorization" : "Basic " + new Buffer.from(username + ":" + password).toString("base64") // 
    }
 * 重写 createConnection，http 支持 tunnel，由于http未加密，
 * 使用 HTTP 1.1 CONNECT 协议，通过http或https连接代理服务器，建立HTTP隧道
 * 
 * *使用示例：
  // 创建agent复用连接，维护给定主机和端口的待处理请求队列
  // 不创建 agent，则使用全局共用的 globalAgent 对象实例
  // agent = false，则创建单次请求的agent，请求完毕自动销毁
  // keepAlive为true时，Agent实例不再使用时，需destroy()，以免消耗资源。
  const agent = new HttpAgent({
    proxy: `http://${px.host}`, // 高效、隧道
    // proxy: cfg.url, // 动态
    // 熊猫高效代理不支持并发，隧道代理支持并发
    // 隧道并发无连接时不受maxSockets限制，会同时新建连接，如代理禁止并发会失败
    // 如设置maxSockets，有连接时，并发会排队，串发不存在此问题
    // 转发只是普通的http请求，支持并发，不建隧道，比隧道快得多，默认转发
    tunnel: true,
    // 连接不关闭，后续请求复用，目的主机如关闭，则无效，连接代理keepAlive需为true 缺省false
    keepAlive: true,
    // 同一目的网址最大并发连接，超过排队，隧道代理或服务器限制并发时需设置，否则报错，默认值：Infinity
    maxSockets: 5, // 无连接，并发连接时，此参数无效，转发代理支持并发无需设置或设置并发数
    maxFreeSockets: 5, // 同一目的主机空闲最大连接，超过关闭。keepAlive true 时有效。默认值：256
    timeout: 10000, // 建立连接时长，缺省 30000
  })
 */ export default class HttpAgent extends http.Agent {
    static{
        this.protocols = [
            'http',
            'https',
            'socks',
            'socks4',
            'socks4a',
            'socks5',
            'socks5h'
        ];
    }
    /**
   * @param {AgentOpts} opts
   */ constructor(opts){
        const { proxy, proxyOpts, tunnel, ...opt } = opts;
        super(opt);
        if (opt.timeout) this.timeout = opt.timeout; // super(opt) 无效
        this.opt = opt;
        let lookup = false;
        /** @type {Proxy} */ let px;
        // let proxy = `http://${username}:${password}@${proxy_ip}:${proxy_port}`
        // let proxy = `socks5h://${username}:${password}@${proxy_ip}:${proxy_port}`
        if (typeof proxy === 'string') ({ proxy: px, lookup } = parseURL(new URL(proxy)));
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
            if ([
                'http:',
                'https:'
            ].includes(px.protocol)) // http[s]代理，可设置隧道或转发模式，socks代理只能隧道
            this.tunnel = tunnel ?? false;
            else this.tunnel = true;
            log('Create HttpAgent proxy: %o tunnel: %d', this.proxy, this.tunnel);
        } else log.error('Create HttpAgent error, not found proxy!');
    }
    /**
   * 修改 request，host 改为代理，目的地写入 path
   * @param {http.ClientRequest} req
   * @param {AgentConnectOpts} opts
   * @returns
   */ addRequest(req, opts) {
        // biome-ignore lint/complexity/noUselessThisAlias: <explanation>
        const _ = this;
        const { proxy } = _;
        if (proxy) {
            let headers = req.getHeaders();
            log({
                headers: {
                    ...headers
                }
            }, 'addRequest'); // 消除 [Object: null prototype]
            // 非隧道，转发模式，修改req连接代理
            if (!_.tunnel) {
                _.setReqProps(req, opts);
                headers = req.getHeaders();
                log({
                    headers: {
                        ...headers
                    }
                }, 'addRequest setReqProps');
            }
        }
        // @ts-ignore
        return super.addRequest(req, opts);
    }
    /**
   * 转发模式，改变请求连接代理，让代理连接目的服务器，实现转发模式代理
   * @param {http.ClientRequest} req
   * @param {AgentConnectOpts} opts
   */ setReqProps(req, opts) {
        // biome-ignore lint/complexity/noUselessThisAlias: <explanation>
        const _ = this;
        const { proxy } = _;
        if (!proxy) return;
        // log({opts}, 'setReqProps')
        const protocol = opts.protocol;
        const host = req.getHeader('host') || 'localhost'; // 带端口
        const base = `${protocol}//${host}`;
        const url = new URL(req.path, base);
        if (opts.port !== 80) url.port = String(opts.port);
        // Change the `http.ClientRequest` instance's "path" field
        // to the absolute path of the URL that will be requested.
        req.path = String(url);
        const port = opts.port && ![
            80,
            443
        ].includes(opts.port) ? `:${opts.port}` : '';
        const path2 = `${opts.protocol}//${opts.hostname}${port}${opts.pathname ?? ''}`;
        log({
            path: req.path,
            path2
        }, 'setReqProps');
        req.setHeader('host', `${opts.hostname}${port}`);
        const pxPort = proxy.port && ![
            80,
            443
        ].includes(proxy.port) ? `:${proxy.port}` : '';
        req.host = `${proxy.host}${pxPort}`;
        if (proxy.protocol) req.protocol = proxy.protocol.includes(':') ? proxy.protocol : `${proxy.protocol}:`;
        // 填入代理 headers
        // if (_.proxyOpts.headers) Object.keys(_.proxyOpts.headers).forEach(k => req.setHeader(k, _.proxyOpts.headers[k]))
        const headers = typeof this.proxyOpts.headers === 'function' ? this.proxyOpts.headers() : {
            ...this.proxyOpts.headers
        };
        // Inject the `Proxy-Authorization` header if necessary.
        if (proxy.username || proxy.password) {
            const auth = `${decodeURIComponent(proxy.username || '')}:${decodeURIComponent(proxy.password || '')}`;
            headers['Proxy-Authorization'] = `Basic ${Buffer.from(auth).toString('base64')}`;
        }
        // req.setHeader('connection', opts.keepAlive ? 'keep-alive' : 'close')
        headers['Proxy-Connection'] = _.opt.keepAlive ? 'Keep-Alive' : 'close';
        headers.connection = _.opt.keepAlive ? 'Keep-Alive' : 'close';
        for (const k of Object.keys(headers)){
            const val = headers[k];
            if (val) req.setHeader(k, val);
        }
    }
    /**
   * http代理支持隧道或非隧道，默认非隧道
   * 默认情况下，此函数与 net.createConnection() 相同。
   * 如需要更大的灵活性，自定义代理可以覆盖此方法。
   * 可以通过以下两种方式之一提供套接字/流：通过从此函数返回套接字/流，或通过将套接字/流传递给回调。
   * 除非用户指定 <net.Socket> 以外的套接字类型，否则此方法保证返回 <net.Socket> 类（<stream.Duplex> 的子类）的实例。
   * 实现proxy 代理，需要重写该方法。
   * @param {AgentConnectOpts} opts
   * @param {(err: Error | null, s?: Duplex) => void} cb
   * callback (err, stream) 返回 连接socket
   */ createConnection(opts, cb) {
        const _ = this;
        const { proxy, proxyOpts } = _;
        if (!proxy) {
            /** @type {net.Socket} */ const socket = net.createConnection(opts);
            socket.once('connect', ()=>{
                log('Create Http Socket Success.');
                cb(null, socket);
            });
            socket.once('close', ()=>log('Http Socket close.'));
        } else {
            // 非隧道，连接代理转发
            if (!_.tunnel) {
                const connOpts = {
                    ...proxyOpts ? omit(proxyOpts, 'headers') : null,
                    host: proxy.host,
                    port: proxy.port
                };
                // Create a socket connection to the proxy server.
                /** @type {net.Socket} */ let socket;
                if (proxy.protocol === 'https:') {
                    log({
                        connOpts
                    }, 'Creating `tls.Socket`');
                    socket = tls.connect(connOpts);
                } else {
                    log({
                        connOpts
                    }, 'Creating `net.Socket`');
                    // socket = super.createConnection(connOpt)
                    socket = net.createConnection(connOpts);
                }
                socket.once('connect', ()=>{
                    log('Create Xfer Socket Success.');
                    cb(null, socket);
                });
                socket.once('close', ()=>log('Xfer Socket close.'));
            } else {
                // HttpAgent隧道模式，只支持 http目标网址，https网址请使用 httpsAgent
                if ([
                    'http:',
                    'https:'
                ].includes(proxy.protocol)) {
                    Promise.resolve().then(()=>connect(opts, this.proxy, this.proxyOpts))// @ts-ignore
                    .then(({ socket, err })=>{
                        socket?.once('close', ()=>log('Tunnel Socket close.'));
                        if (socket && opts.protocol === 'http:') {
                            log('Create Tunnel Socket Success.');
                            cb(null, socket);
                        } else if (socket) {
                            socket.destroy();
                            log.error('Create Tunnel Socket Success, protocol not http.');
                            cb(new Error('Bad Protocol.'), null);
                        } else if (err) {
                            log.error('Create Tunnel Socket Fail.');
                            cb(err, null);
                        }
                    }).catch((err)=>{
                        log.err(err, 'createConnection');
                        cb(err, null);
                    });
                } else {
                    const px = {
                        ...omit(proxy, 'username', 'protocol')
                    };
                    Promise.resolve().then(()=>socksConnect(opts, px, this.lookup)).then((socket)=>{
                        if (socket) {
                            log('Created Socket Success.');
                            cb(null, socket);
                        } else log.error('Creat Socket Fail.');
                    }).catch((err)=>{
                        log.err(err, 'createConnection');
                        cb(err);
                    });
                }
            }
        }
    }
}

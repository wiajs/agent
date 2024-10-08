import http from 'node:http';
import https from 'node:https';
import {log as Log, name} from '@wiajs/log';
import {connect, socksConnect, parseURL} from './tunnel.js';

const log = Log({env: `wia:agent:${name(__filename)}`});

/** @typedef {import('stream').Duplex} Duplex */
/** @typedef {import('./tunnel').AgentConnectOpts} AgentConnectOpts */
/** @typedef {import('./tunnel').Proxy} Proxy */
/** @typedef {http.AgentOptions & https.AgentOptions & {proxy: string|Proxy, proxyOpts?: *, tunnel?: boolean}} AgentOpts */

/**
 * 隧道代理，实现HTTPS目的网址访问
 * 重写 https.Agent的createConnection
 * 使用 HTTP 1.1 CONNECT 协议，通过http或https连接代理服务器，建立TLS隧道，
 */
export default class HttpsAgent extends https.Agent {
  static protocols = ['http', 'https', 'socks', 'socks4', 'socks4a', 'socks5', 'socks5h'];
  /**
   * @param {AgentOpts} opts
   */
  constructor(opts) {
    const {proxy, proxyOpts, ...opt} = opts;
    super(opt);

    if (opt.timeout) this.timeout = opt.timeout; // super(opt) 无效
    this.opt = opt;

    let lookup = false;
    /** @type {Proxy} */
    let px;
    if (typeof proxy === 'string')
      // let proxy = `http://${username}:${password}@${proxy_ip}:${proxy_port}`
      // let proxy = `socks5h://${username}:${password}@${proxy_ip}:${proxy_port}`
      ({proxy: px, lookup} = parseURL(new URL(proxy)));
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
      log('Create HttpsAgent proxy :%o', this.proxy);
    } else log.error('Create HttpsAgent error, not found proxy!');
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
   */
  createConnection(opts, cb) {
    const _ = this;
    const {proxy, proxyOpts} = _;
    if (!proxy) {
      // @ts-ignore
      const socket = super.createConnection(opts);
      socket.once('connect', () => {
        log('Create Https Socket Success.');
        cb(null, socket);
      });
      socket.once('close', () => log('Https Socket close.'));
    } else {
      if (['http:', 'https:'].includes(proxy.protocol)) {
        Promise.resolve()
          .then(() => connect(opts, proxy, proxyOpts))
          // @ts-ignore
          .then(({socket, err}) => {
            if (socket && opts.protocol === 'https:') {
              // @ts-ignore
              const secureSocket = super.createConnection({...opts, socket});
              if (secureSocket) {
                secureSocket?.once('close', () => log('Secure Socket close.'));

                log('Create Secure Socket Success.');
                cb(null, secureSocket);
              } else log.error('Create Secure Socket Fail.');
            } else if (err) cb(err, null);
          })
          .catch(err => {
            log.err(err);
            cb(err);
          });
      } else {
        Promise.resolve()
          .then(() => socksConnect(opts, proxy, this.lookup))
          .then(socket => {
            if (socket && opts.protocol === 'https:') {
              // @ts-ignore
              const secureSocket = super.createConnection({...opts, socket});
              if (secureSocket) {
                log('Created secureSocket Success.');
                cb(null, secureSocket);
              } else log.error('Creat secureSocket Fail.');
            }
          })
          .catch(err => {
            log.err(err, 'createConnection');
            cb(err);
          });
      }
    }
  }
}

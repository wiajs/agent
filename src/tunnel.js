import {log as Log, name} from '@wiajs/log'
import * as dns from 'dns'
import http from 'http'
import https from 'https'
import * as net from 'net'
import {SocksClient} from 'socks'
import * as tls from 'tls'

const log = Log({env: `wia:agent:${name(import.meta.url)}`})

/** @typedef {import('stream').Duplex} Duplex */
/** @typedef {{protocol?: string, keepAlive: boolean, lookup: dns.lookup} & import('net').TcpNetConnectOpts} HttpConnectOpts */
/** @typedef {{servername?:string, protocol?: string, port: number, keepAlive: boolean, lookup: dns.lookup} & import('tls').ConnectionOptions} HttpsConnectOpts */
/** @typedef {HttpConnectOpts | HttpsConnectOpts} AgentConnectOpts */
/** @typedef {{protocol: string, host: string, port: number, type?: number, username?: string, userId?: string, password?: string}} Proxy */

/**
 * 通过 http[s] 创建隧道代理连接
 * @param {AgentConnectOpts} opts
 * @param {Proxy} proxy
 * @param {*} proxyOpts
 * @returns {Promise<{socket: net.Socket | tls.TLSSocket, err: *}>}
 */
async function connect(opts, proxy, proxyOpts) {
  // @ts-ignore
  let R = {socket: null, err: null}
  try {
    // log({proxy, proxyOpts}, 'connect')

    // 连接代理
    const connOpts = {
      // Attempt to negotiate http/1.1 for proxy servers that support http/2
      // ALPNProtocols: ['http/1.1'],
      ...(proxyOpts ? omit(proxyOpts, 'headers') : null),
      method: 'CONNECT',
      host: proxy.host,
      port: proxy.port,
      path: `${opts.host}:${opts.port}`,
      setHost: false,
      headers: {
        ...(proxyOpts?.headers || {}),
        connection: opts.keepAlive ? 'keep-alive' : 'close',
        'Proxy-Connection': opts.keepAlive ? 'keep-alive' : 'close',
        host: `${opts.host}:${opts.port}`,
      },
      agent: false, // 单次有效，不复用
      timeout: opts.timeout || 0,
    }

    // Basic proxy authorization
    if (proxy.username || proxy.password) {
      const base64 = Buffer.from(
        `${decodeURIComponent(proxy.username || '')}:${decodeURIComponent(proxy.password || '')}`
      ).toString('base64')
      connOpts.headers['proxy-authorization'] = `Basic ${base64}`
    }

    // Necessary for the TLS check with the proxy to succeed.
    if (proxy.protocol === 'https:') connOpts.servername = proxy.host

    log({connOpts}, 'connect request')

    R = await new Promise((resolve, reject) => {
      // 连接代理服务器
      const request = (proxy.protocol === 'http:' ? http : https).request(connOpts)
      request.once('connect', (response, socket, head) => {
        request.removeAllListeners()
        socket.removeAllListeners()
        if (response.statusCode === 200) {
          log('Tunnel proxy connect Success.')
          resolve({socket, err: null})
          // const secureSocket = super.createConnection({...opts, socket})
          // callback(null, secureSocket)
        } else {
          socket.destroy()
          resolve({socket: null, err: new Error(`Bad response: ${response.statusCode}`)})
          // callback(new Error(`Bad response: ${response.statusCode}`), null)
          log.error('Tunnel proxy connect Fail.')
        }
      })

      request.once('timeout', () => {
        log.error('connect timeout')
        request.destroy(new Error('Proxy timeout'))
      })

      request.once('error', err => {
        request.removeAllListeners()
        resolve({socket: null, err})
        log.err(err, 'connect')
        // callback(err, null)
      })
      request.end()
    })
  } catch (e) {
    log.err(e, 'connect')
    R.err = e
  }

  return R
}

/**
 * 解析域名为ip地址
 * @param {string} host
 * @param {dns.lookup} lookupFn
 * @returns {Promise<string>}
 */
async function lookup(host, lookupFn) {
  let R
  try {
    R = new Promise((res, rej) => {
      // Use the request's custom lookup, if one was configured:
      lookupFn(host, {}, (err, addr, family) => {
        if (err) rej(err)
        else res(addr)
      })
    })

    log({R}, 'lookup')
  } catch (e) {
    log.err(e, 'lookup')
  }
  return R
}

/**
 * 通过 socks 创建隧道代理连接
 * @param {AgentConnectOpts} opts
 * @param {Proxy} proxy
 * @param {boolean} [shouldLookup=false]
 * @returns {Promise<net.Socket | tls.TLSSocket>}
 */
async function socksConnect(opts, proxy, shouldLookup = false) {
  let R
  try {
    const {timeout} = opts
    let {host, port} = opts

    if (!host) throw new Error('No `host` defined!')

    port = typeof port === 'number' ? port : Number.parseInt(port)
    const {lookup: lookupFn = dns.lookup} = opts

    if (shouldLookup) {
      // Client-side DNS resolution for "4" and "5" socks proxy versions.
      host = await lookup(host, lookupFn)
    }

    // Using socks library to create SOCKS connection
    /** @type {*} */
    const connOpt = {
      proxy,
      destination: {
        host,
        port,
      },
      command: 'connect',
      timeout: timeout ?? undefined,
    }

    log({connOpt}, 'socksConnect')

    const {socket} = await SocksClient.createConnection(connOpt)
    if (socket) {
      R = socket
      log('Socks proxy connect Success.')
      if (timeout) {
        socket.setTimeout(timeout)
        socket.on('timeout', () => socket.destroy())
      }
    } else log.error('Socks proxy connect Fail.')
  } catch (e) {
    log.err(e, 'socksConnect')
  }

  return R
}

/**
 * 解析url，获取代理参数
 * @param {URL} url
 * @returns  {{lookup: boolean, proxy: Proxy}}
 */
function parseURL(url) {
  let R
  try {
    let lookup = false
    const host = url.hostname
    const port = url.port ? Number.parseInt(url.port) : 0

    /** @type {Proxy} */
    const proxy = {
      protocol: url.protocol,
      host,
      port,
    }

    if (url.username) {
      proxy.username = decodeURIComponent(url.username)
      proxy.userId = decodeURIComponent(url.username)
    }

    if (url.password) proxy.password = decodeURIComponent(url.password)

    if (['http:', 'https:'].includes(url.protocol)) {
      if (!port) proxy.port = url.protocol === 'https:' ? 443 : 80
    } else {
      // From RFC 1928, Section 3: https://tools.ietf.org/html/rfc1928#section-3
      // "The SOCKS service is conventionally located on TCP port 1080"
      if (!port) proxy.port = 1080

      let type = 5

      // figure out if we want socks v4 or v5, based on the "protocol" used.
      // Defaults to 5.
      switch (url.protocol.replace(':', '')) {
        case 'socks4':
          lookup = true
          type = 4
          break
        // pass through
        case 'socks4a':
          type = 4
          break
        case 'socks5':
          lookup = true
          type = 5
          break
        // pass through
        case 'socks': // no version specified, default to 5h
          type = 5
          break
        case 'socks5h':
          type = 5
          break
        default:
          type = 5
      }

      proxy.type = type
    }

    R = {lookup, proxy}
    // log({url, proxy}, 'parseURL')
  } catch (e) {
    log.err(e, 'parseURL')
  }

  return R
}

/**
 * 排除对象字段
 * @param {*} obj
 * @param  {...any} keys
 * @returns {*}
 */
function omit(obj, ...keys) {
  /** @type {*} */
  const R = {}
  for (const k of Object.keys(obj)) {
    if (!keys.includes(k)) R[k] = obj[k]
  }
  return R
}

export {connect, omit, parseURL, socksConnect}

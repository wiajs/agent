export type Duplex = import("stream").Duplex;
export type HttpConnectOpts = {
    protocol?: string;
    keepAlive: boolean;
    lookup: typeof dns.lookup;
} & import("net").TcpNetConnectOpts;
export type HttpsConnectOpts = {
    servername?: string;
    protocol?: string;
    port: number;
    keepAlive: boolean;
    lookup: typeof dns.lookup;
} & import("tls").ConnectionOptions;
export type AgentConnectOpts = HttpConnectOpts | HttpsConnectOpts;
export type Proxy = {
    protocol: string;
    host: string;
    port: number;
    type?: number;
    username?: string;
    userId?: string;
    password?: string;
};
export function parseURL(url: URL): {
    lookup: boolean;
    proxy: Proxy;
};
export function connect(opts: AgentConnectOpts, proxy: Proxy, proxyOpts: any): Promise<{
    socket: net.Socket | tls.TLSSocket;
    err: any;
}>;
export function socksConnect(opts: AgentConnectOpts, proxy: Proxy, shouldLookup?: boolean): Promise<net.Socket | tls.TLSSocket>;
export function omit(obj: any, ...keys: any[]): any;
import * as dns from 'node:dns';
import * as net from 'node:net';
import * as tls from 'node:tls';

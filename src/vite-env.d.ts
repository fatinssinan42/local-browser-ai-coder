/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SIGNALING_SERVER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.css' {}
declare module 'simple-peer' {
  export default class SimplePeer {
    constructor(opts?: any);
    signal(data: any): void;
    send(data: string | Uint8Array): void;
    on(event: string, cb: (...args: any[]) => void): void;
    destroy(): void;
  }
  export interface Instance extends SimplePeer {}
}

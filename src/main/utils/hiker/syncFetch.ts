import syncFetch from 'sync-fetch';
import FormData from 'form-data';
import { Buffer } from 'buffer';
import mime from 'mime-types';
import fs from 'fs-extra';
import { MOBILE_UA, PC_UA } from './ua';
import { getHome, keysToLowerCase, parseQueryString } from './base';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const getTimeout = (timeout: number | undefined | null) => {
  const baseTimeout = 5000;

  if (timeout !== null && timeout !== undefined) {
    return Math.max(baseTimeout, timeout);
  }

  if (globalThis.variable?.timeout) {
    return Math.max(baseTimeout, globalThis.variable.timeout);
  }

  return baseTimeout;
};

const toTitleCase = (str: string) => {
  return str
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('-');
};

const toString = (val: any): string => {
  switch (typeof val) {
    case 'undefined':
      return '';
    case 'number':
      return String(val);
    case 'bigint':
      return `${String(val)}n`;
    case 'string':
      return val;
    case 'boolean':
      return val ? 'true' : 'false';
    case 'symbol':
    case 'function':
      return val.toString();
    case 'object':
      if (val === null) return 'null';
      if (val instanceof Date) return val.toISOString();
      if (val instanceof Map) return JSON.stringify(Object.fromEntries(val));
      if (val instanceof Set) return JSON.stringify(Array.from(val));
      try {
        return JSON.stringify(val);
      } catch {
        return '[object Object]';
      }
    default:
      return val?.toString?.() || '';
  }
};

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD';

interface RequestOptions {
  method?: HttpMethod;
  timeout?: number;
  body?: { [key: string]: string } | string;
  headers?: { [key: string]: string };
  redirect?: 0 | 1 | boolean;
  toHex?: boolean;
  onlyHeaders?: boolean;
  withHeaders?: boolean;
  withStatusCode?: boolean;
}

const fetch = (url: string, options: RequestOptions = {}) => {
  try {
    const method: HttpMethod = (options.method || 'GET').toUpperCase() as HttpMethod;
    url = new URL(url).href;

    const headers = options?.headers || {};
    const headersInTitleCase = Object.keys(headers).reduce((obj, key) => {
      obj[toTitleCase(key)] = headers[key];
      return obj;
    }, {});

    const config = {
      method,
      headers: headersInTitleCase,
      timeout: getTimeout(options?.timeout),
      redirect: options?.redirect === false ? 'manual' : 'follow',
    };

    if (!config.headers['User-Agent']) {
      config.headers['User-Agent'] = MOBILE_UA;
    }

    if (!config.headers['Referer']) {
      config.headers['Referer'] = getHome(url);
    }

    if (/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(config.headers['Referer'])) {
      config.headers['Referer'] = new URL(config.headers['Referer']).href;
    }

    const contentType = config.headers?.['Content-Type'] || '';
    let charset: string = 'utf-8';

    if (contentType.includes('charset=')) {
      const matchRes = contentType.match(/charset=[\w-]+/);
      if (matchRes && matchRes.length > 0) {
        const charsetMatch = matchRes[0].match(/charset=([\w-]+)/);
        if (charsetMatch && charsetMatch.length > 1) {
          charset = charsetMatch[1];
        }
      }
    }

    if (method !== 'GET') {
      if (contentType.includes('application/x-www-form-urlencoded')) {
        const body = parseQueryString(options.body as string) as Record<string, string>;
        config['body'] = new URLSearchParams(body).toString();
      } else if (contentType.includes('text/plain')) {
        config['body'] = options.body;
      } else if (contentType.includes('multipart/form-data')) {
        const fd = new FormData();
        fd.append('file', fs.readFileSync(options.body as string), options.body as string);
        config['body'] = fd;
        config['headers']['Content-Type'] = fd.getHeaders();
      } else {
        if (!config.headers['content-type']) config['headers']['Content-Type'] = 'application/json';
        const body = parseQueryString(options.body as string);
        config['body'] = JSON.stringify(body);
      }
    }

    console.warn(`[request] url: ${url} | method: ${method} | options: ${JSON.stringify(config)}`);

    let resp = syncFetch(url, config);
    resp.getBody = function (encoding: BufferEncoding | undefined) {
      const buffer = resp.buffer();
      return encoding ? Buffer.from(buffer).toString(encoding) : buffer;
    };

    const { onlyHeaders, withHeaders, withStatusCode, toHex } = options || {};

    // 仅返回 headers 的场景
    if (onlyHeaders) {
      return toString(resp.headers.raw());
    };

    // 处理响应体
    const content = toHex ? Buffer.from(resp.getBody()).toString('hex') : resp.getBody(charset);

    // 仅返回非 headers 或 statusCode 的场景
    if (!(withHeaders || withStatusCode)) {
      return toString(content);
    };

    return toString({
      headers: resp.headers.raw(),
      statusCode: resp.status,
      body: content,
    });
  } catch (err: any) {
    console.log(err);
    return null;
  }
};

const request = fetch;

const fetchCookie = (url: string, options: RequestOptions = {}) => {
  if (options?.withHeaders) delete options.withHeaders;
  if (options?.withStatusCode) delete options.withStatusCode;
  if (options?.toHex) delete options.toHex;
  options = Object.assign(options, { onlyHeaders: true });
  const header = fetch(url, options) || {};
  const setCk = Object.keys(header).find((it) => it.toLowerCase() === 'set-cookie');
  const cookie = setCk ? header[setCk] : '[]';
  return toString(cookie);
};

const post = (url: string, options: RequestOptions = {}) => {
  options = Object.assign(options, { method: 'POST' });
  return fetch(url, options);
};

const fetchPC = (url: string, options: RequestOptions = {}) => {
  options.headers = options?.headers || {};
  const headers = keysToLowerCase(options.headers);
  if (!headers['user-agent']) {
    options.headers['User-Agent'] = PC_UA;
  }
  return fetch(url, options);
};

const postPC = (url: string, options: RequestOptions = {}) => {
  options.headers = options?.headers || {};
  const headers = keysToLowerCase(options.headers);
  if (!headers['user-agent']) {
    options.headers['User-Agent'] = PC_UA;
  }
  return post(url, options);
};

const convertBase64Image = (url: string, options: RequestOptions = {}) => {
  try {
    if (options?.withHeaders) delete options.withHeaders;
    if (options?.withStatusCode) delete options.withStatusCode;
    if (options?.toHex) delete options.toHex;
    if (options?.onlyHeaders) delete options.onlyHeaders;
    options = Object.assign(options, { toHex: true });
    const res = fetch(url, options) || '{"body":""}';
    const formatRes = JSON.parse(res);
    const hexStr = formatRes.body;
    const base64String = Buffer.from(hexStr, 'hex').toString('base64');
    return `data:${mime.lookup(url)};base64,${base64String}`;
  } catch (err) {
    console.log(err);
    return '';
  }
};

const batchFetch = (requests: any[], threads: number = 16) => {
  const results: any[] = [];
  const processBatch = (batchSize: number, index: number = 0) => {
    // 如果当前索引小于请求数组的长度，说明还有请求需要处理
    if (index < requests.length) {
      // 处理当前批次的请求
      const batch = requests.slice(index, index + batchSize);
      for (const request of batch) {
        try {
          const response = fetch(request.url, request.options);
          results.push(response);
        } catch (err: any) {
          results.push(`Request to ${request.url} failed: ${err.message}`);
        }
      }
      // 递归处理下一批请求
      processBatch(batchSize, index + batchSize);
    }
  };

  // 根据请求总数决定批次大小，超过16个请求则分批处理
  const batchSize = requests.length > threads ? threads : requests.length;
  processBatch(batchSize);
  return results;
};

const bf = batchFetch;

export { fetch, request, fetchCookie, post, fetchPC, postPC, convertBase64Image, batchFetch, bf };

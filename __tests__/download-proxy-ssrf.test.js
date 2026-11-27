/**
 * @jest-environment node
 */
/* global describe, expect, it, jest, beforeEach, afterAll */

const envBackup = { ...process.env };

beforeEach(() => {
  jest.resetModules();
  process.env = { ...envBackup, NEXT_PUBLIC_AUTH_MODE: 'public' };
});

afterAll(() => {
  process.env = envBackup;
});

function loadRoute() {
  return require('../src/app/api/download/proxy/route');
}

function makeRequest(url) {
  const { NextRequest } = require('next/server');
  return new NextRequest(
    `http://localhost/api/download/proxy?url=${encodeURIComponent(url)}`,
  );
}

describe('下载代理 SSRF 防护', () => {
  const blocked = [
    'http://127.0.0.1/secret',
    'http://localhost:8080/admin',
    'http://10.0.0.1/',
    'http://192.168.1.1/',
    'http://172.16.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
  ];

  it.each(blocked)('阻止内网地址 %s', async (url) => {
    const { GET } = loadRoute();
    const res = await GET(makeRequest(url));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Private network/);
  });

  it('公网地址通过 SSRF 检查（返回非 400）', async () => {
    const { GET } = loadRoute();
    // 公网地址会通过校验，随后因无鉴权或上游不可达返回其它状态
    const res = await GET(makeRequest('https://example.com/video.ts'));
    expect(res.status).not.toBe(400);
  });
});

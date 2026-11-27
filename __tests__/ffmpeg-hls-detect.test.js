/**
 * @jest-environment node
 */
/* global describe, expect, it */

const { isHlsSource } = require('../src/lib/ffmpeg-download');

describe('FFmpeg 分片扩展名放行的条件判定', () => {
  it('识别标准 m3u8 播放列表', () => {
    expect(isHlsSource('https://example.com/index.m3u8')).toBe(true);
    expect(isHlsSource('https://example.com/INDEX.M3U8?token=1')).toBe(true);
  });

  it('识别站内 m3u8 代理（原始地址被编码进 query）', () => {
    const url =
      'http://127.0.0.1:3000/api/proxy/m3u8-filter?url=https%3A%2F%2Fplay.ly166.com%3A65%2Fvideos%2Findex.m3u8&sig=abc';
    expect(isHlsSource(url)).toBe(true);
    expect(isHlsSource('http://h/api/proxy/m3u8-asset?kind=segment')).toBe(
      true,
    );
  });

  it('普通 mp4 / ts 直链不触发（避免误加 hls 专有参数）', () => {
    expect(isHlsSource('https://example.com/movie.mp4')).toBe(false);
    expect(isHlsSource('https://example.com/clip.ts')).toBe(false);
    expect(isHlsSource('https://example.com/stream.mkv')).toBe(false);
  });
});

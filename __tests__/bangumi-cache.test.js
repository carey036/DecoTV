/* global describe, expect, it, jest */

const {
  createBangumiSubscription,
  normalizeBangumiIntervalHours,
  applyBangumiSubscriptionUpdate,
  getNextBangumiCheckAt,
} = require('../src/lib/bangumi-subscription');

const input = {
  source: 'source-a',
  videoId: 'video-1',
  title: '测试番剧',
  sourceName: '测试源',
  cover: '',
  year: '2026',
  totalEpisodes: 24,
  episodeTitles: Array.from({ length: 24 }, (_, i) => `第${i + 1}集`),
};

describe('追番缓存 - 补历史剧集', () => {
  it('新订阅默认补历史，缓存进度从 0 开始', () => {
    const sub = createBangumiSubscription(input);
    expect(sub.cacheExistingEpisodes).toBe(true);
    expect(sub.cachedThroughEpisode).toBe(0);
    expect(sub.lastKnownEpisodeCount).toBe(24);
  });

  it('显式关闭补历史时，跳过已播出剧集', () => {
    const sub = createBangumiSubscription({
      ...input,
      cacheExistingEpisodes: false,
    });
    expect(sub.cacheExistingEpisodes).toBe(false);
    expect(sub.cachedThroughEpisode).toBe(24);
  });

  it('从「不补历史」切到「补历史」时重置进度并立即到期', () => {
    const before = createBangumiSubscription({
      ...input,
      cacheExistingEpisodes: false,
    });
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const after = applyBangumiSubscriptionUpdate(before, {
      cacheExistingEpisodes: true,
    });
    nowSpy.mockRestore();

    expect(after.cachedThroughEpisode).toBe(0);
    expect(after.nextCheckAt).toBe(1_700_000_000_000);
    expect(after.updatedAt).toBe(1_700_000_000_000);
  });

  it('周期更新不重置已缓存进度', () => {
    const sub = createBangumiSubscription(input);
    const updated = applyBangumiSubscriptionUpdate(sub, {
      intervalHours: 12,
    });
    expect(updated.cachedThroughEpisode).toBe(sub.cachedThroughEpisode);
  });
});

describe('追番缓存 - 工具函数', () => {
  it('检查周期被限制在 1 到 168 小时', () => {
    expect(normalizeBangumiIntervalHours(0)).toBe(1);
    expect(normalizeBangumiIntervalHours(999)).toBe(168);
    expect(normalizeBangumiIntervalHours('abc')).toBe(24);
  });

  it('下次检查时间按周期计算', () => {
    const from = 1_700_000_000_000;
    expect(getNextBangumiCheckAt(24, from)).toBe(from + 24 * 60 * 60 * 1000);
  });
});

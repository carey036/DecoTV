import type { DownloadChannel } from './download-types';
import type { SearchResult } from './types';

export type BangumiSubscriptionStatus =
  | 'idle'
  | 'checking'
  | 'updated'
  | 'cached'
  | 'error';

export interface BangumiSubscription {
  id: string;
  source: string;
  videoId: string;
  title: string;
  sourceName: string;
  cover: string;
  year: string;
  searchTitle?: string;
  enabled: boolean;
  autoCache: boolean;
  /** 订阅时是否把已播出的剧集也纳入缓存（默认开启） */
  cacheExistingEpisodes: boolean;
  intervalHours: number;
  downloadChannel: DownloadChannel;
  lastKnownEpisodeCount: number;
  cachedThroughEpisode: number;
  episodeTitles: string[];
  createdAt: number;
  updatedAt: number;
  nextCheckAt: number;
  lastCheckedAt?: number;
  lastNewEpisodeCount?: number;
  lastCachedEpisodeCount?: number;
  status: BangumiSubscriptionStatus;
  lastError?: string;
}

export interface BangumiSubscriptionInput {
  source: string;
  videoId: string;
  title: string;
  sourceName: string;
  cover: string;
  year: string;
  searchTitle?: string;
  totalEpisodes: number;
  episodeTitles?: string[];
  cacheExistingEpisodes?: boolean;
}

export interface BangumiSubscriptionUpdate {
  enabled?: boolean;
  autoCache?: boolean;
  /** 开启后从第一集补下历史剧集；关闭后仅缓存未来新增集 */
  cacheExistingEpisodes?: boolean;
  intervalHours?: number;
  downloadChannel?: DownloadChannel;
}

const STORAGE_KEY = 'decotv_bangumi_subscriptions_v1';
const MIN_INTERVAL_HOURS = 1;
const MAX_INTERVAL_HOURS = 168;
const DEFAULT_INTERVAL_HOURS = 24;

export function createBangumiSubscriptionId(
  source: string,
  videoId: string,
): string {
  return `${source}+${videoId}`;
}

export function normalizeBangumiIntervalHours(value: unknown): number {
  const parsed =
    typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_INTERVAL_HOURS;
  return Math.min(
    MAX_INTERVAL_HOURS,
    Math.max(MIN_INTERVAL_HOURS, Math.round(parsed)),
  );
}

export function getNextBangumiCheckAt(
  intervalHours: number,
  from = Date.now(),
): number {
  return from + normalizeBangumiIntervalHours(intervalHours) * 60 * 60 * 1000;
}

export function formatBangumiTime(timestamp?: number): string {
  if (!timestamp) return '尚未检查';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

export function formatBangumiInterval(intervalHours: number): string {
  const hours = normalizeBangumiIntervalHours(intervalHours);
  if (hours % 24 === 0) {
    const days = hours / 24;
    return days === 1 ? '每天' : `每 ${days} 天`;
  }
  return `每 ${hours} 小时`;
}

function sanitizeSubscription(raw: unknown): BangumiSubscription | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<BangumiSubscription>;
  if (!item.source || !item.videoId || !item.title) return null;

  const id = item.id || createBangumiSubscriptionId(item.source, item.videoId);
  const now = Date.now();
  const intervalHours = normalizeBangumiIntervalHours(item.intervalHours);
  const lastKnownEpisodeCount = Math.max(0, item.lastKnownEpisodeCount || 0);
  const cachedThroughEpisode = Math.max(
    0,
    item.cachedThroughEpisode ?? lastKnownEpisodeCount,
  );
  const cacheExistingEpisodes = item.cacheExistingEpisodes === true;
  // 迁移：开启了补历史集、但历史集尚未缓存完成、且从未检查过的订阅，
  // 立即到期以触发补下（修复旧版本订阅 nextCheckAt 落在 24 小时后的问题）
  const needsBackfill =
    cacheExistingEpisodes &&
    cachedThroughEpisode < lastKnownEpisodeCount &&
    !item.lastCheckedAt;

  return {
    id,
    source: item.source,
    videoId: item.videoId,
    title: item.title,
    sourceName: item.sourceName || item.source,
    cover: item.cover || '',
    year: item.year || 'unknown',
    searchTitle: item.searchTitle || item.title,
    enabled: item.enabled !== false,
    autoCache: item.autoCache !== false,
    // 旧订阅没有该字段时保持原有语义（不补历史集），避免升级后突然下载全部剧集
    cacheExistingEpisodes,
    intervalHours,
    downloadChannel: item.downloadChannel === 'ffmpeg' ? 'ffmpeg' : 'browser',
    lastKnownEpisodeCount,
    cachedThroughEpisode,
    episodeTitles: Array.isArray(item.episodeTitles)
      ? item.episodeTitles.filter((title): title is string => Boolean(title))
      : [],
    createdAt: item.createdAt || now,
    updatedAt: item.updatedAt || now,
    nextCheckAt: needsBackfill
      ? now
      : typeof item.nextCheckAt === 'number'
        ? item.nextCheckAt
        : getNextBangumiCheckAt(intervalHours, now),
    lastCheckedAt: item.lastCheckedAt,
    lastNewEpisodeCount: item.lastNewEpisodeCount,
    lastCachedEpisodeCount: item.lastCachedEpisodeCount,
    status: item.status || 'idle',
    lastError: item.lastError,
  };
}

export function loadBangumiSubscriptions(): BangumiSubscription[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sanitizeSubscription)
      .filter((item): item is BangumiSubscription => Boolean(item))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function saveBangumiSubscriptions(
  subscriptions: BangumiSubscription[],
): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(subscriptions));
}

export function createBangumiSubscription(
  input: BangumiSubscriptionInput,
): BangumiSubscription {
  const now = Date.now();
  const totalEpisodes = Math.max(0, input.totalEpisodes || 0);
  const intervalHours = DEFAULT_INTERVAL_HOURS;
  // 新订阅默认补下已播出的全部剧集，从 0 开始；关闭时才跳过历史集
  const cacheExistingEpisodes = input.cacheExistingEpisodes !== false;

  return {
    id: createBangumiSubscriptionId(input.source, input.videoId),
    source: input.source,
    videoId: input.videoId,
    title: input.title,
    sourceName: input.sourceName || input.source,
    cover: input.cover || '',
    year: input.year || 'unknown',
    searchTitle: input.searchTitle || input.title,
    enabled: true,
    autoCache: true,
    cacheExistingEpisodes,
    intervalHours,
    downloadChannel: 'ffmpeg',
    lastKnownEpisodeCount: totalEpisodes,
    cachedThroughEpisode: cacheExistingEpisodes ? 0 : totalEpisodes,
    episodeTitles: input.episodeTitles || [],
    createdAt: now,
    updatedAt: now,
    // 补历史集时必须立即到期，让前端下一次轮询马上补下已播出剧集；
    // 否则默认 24 小时后才首次检查，用户会觉得「订阅了但没下载」
    nextCheckAt: cacheExistingEpisodes
      ? now
      : getNextBangumiCheckAt(intervalHours, now),
    status: 'idle',
  };
}

export function createBangumiSubscriptionFromDetail(
  detail: SearchResult,
  source: string,
  videoId: string,
  fallbackTitle: string,
  searchTitle?: string,
): BangumiSubscription {
  return createBangumiSubscription({
    source,
    videoId,
    title: detail.title || fallbackTitle,
    sourceName: detail.source_name || source,
    cover: detail.poster || '',
    year: detail.year || 'unknown',
    searchTitle: searchTitle || fallbackTitle || detail.title,
    totalEpisodes: detail.episodes?.length || 0,
    episodeTitles: detail.episodes_titles || [],
  });
}

export function applyBangumiSubscriptionUpdate(
  subscription: BangumiSubscription,
  update: BangumiSubscriptionUpdate,
): BangumiSubscription {
  const intervalHours =
    update.intervalHours === undefined
      ? subscription.intervalHours
      : normalizeBangumiIntervalHours(update.intervalHours);

  // 从「不补历史」切到「补历史」时重置进度，让下一次检查补下已播出集数
  const shouldBackfill =
    update.cacheExistingEpisodes === true &&
    subscription.cacheExistingEpisodes === false;

  return {
    ...subscription,
    ...update,
    intervalHours,
    updatedAt: Date.now(),
    cachedThroughEpisode: shouldBackfill
      ? 0
      : subscription.cachedThroughEpisode,
    // 补历史时立即到期，让下一次轮询马上补下
    nextCheckAt: shouldBackfill
      ? Date.now()
      : update.intervalHours === undefined
        ? subscription.nextCheckAt
        : getNextBangumiCheckAt(intervalHours),
    downloadChannel:
      update.downloadChannel === undefined
        ? subscription.downloadChannel
        : update.downloadChannel === 'ffmpeg'
          ? 'ffmpeg'
          : 'browser',
  };
}

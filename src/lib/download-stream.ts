/* eslint-disable no-console, no-undef */
'use client';

/**
 * 浏览器侧大文件流式合并。
 *
 * 旧实现把所有分片读进 Blob[] 再合成一个大 Blob，几 GB 的番剧会直接 OOM。
 * 这里优先使用 OPFS（Origin Private File System）逐片写入磁盘，
 * 最后拿到的 File 由浏览器按需读取，不会整体进 JS 内存。
 * 不支持 OPFS 的浏览器回退到内存合并（保留旧行为）。
 */

const OPFS_ROOT = 'decotv-downloads';

function supportsOpfs(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    Boolean(
      (navigator as Navigator & { storage?: StorageManager }).storage
        ?.getDirectory,
    )
  );
}

async function getOpfsRoot(): Promise<FileSystemDirectoryHandle> {
  const storage = (navigator as Navigator & { storage: StorageManager })
    .storage;
  const root = await storage.getDirectory();
  return root.getDirectoryHandle(OPFS_ROOT, { create: true });
}

function fileKey(taskId: string, fileName: string): string {
  return `${taskId}__${fileName}`;
}

export interface StreamMergeOptions {
  taskId: string;
  fileName: string;
  totalSegments: number;
  readSegment: (index: number) => Promise<Blob | null>;
  onProgress?: (mergedSegments: number) => void;
}

export interface StreamMergeResult {
  /** OPFS 中的 File，可直接用于下载，避免整体入内存 */
  file?: File;
  /** 内存回退时的 Blob */
  blob?: Blob;
  mode: 'opfs' | 'memory';
}

/** 尝试用 OPFS 流式写入；任何异常都回退到内存合并 */
export async function mergeSegmentsStreaming(
  options: StreamMergeOptions,
): Promise<StreamMergeResult> {
  if (supportsOpfs()) {
    try {
      const file = await writeSegmentsToOpfs(options);
      return { file, mode: 'opfs' };
    } catch (error) {
      console.warn('[download-stream] OPFS 写入失败，回退内存合并:', error);
    }
  }

  const parts: Blob[] = [];
  for (let index = 0; index < options.totalSegments; index += 1) {
    const blob = await options.readSegment(index);
    if (!blob) throw new Error(`分片 ${index + 1} 缺失，无法合并`);
    parts.push(blob);
    options.onProgress?.(index + 1);
  }
  return {
    blob: new Blob(parts, {
      type: /\.mp4$/i.test(options.fileName) ? 'video/mp4' : 'video/mp2t',
    }),
    mode: 'memory',
  };
}

async function writeSegmentsToOpfs(options: StreamMergeOptions): Promise<File> {
  const root = await getOpfsRoot();
  const fileHandle = await root.getFileHandle(
    fileKey(options.taskId, options.fileName),
    { create: true },
  );
  const writable = await fileHandle.createWritable();
  try {
    for (let index = 0; index < options.totalSegments; index += 1) {
      const blob = await options.readSegment(index);
      if (!blob) throw new Error(`分片 ${index + 1} 缺失，无法合并`);
      await writable.write(blob);
      options.onProgress?.(index + 1);
    }
  } finally {
    // 无论成功失败都要关闭，避免文件句柄泄漏
    await writable.close();
  }
  return fileHandle.getFile();
}

/** 下载 OPFS 文件；用 File 直接生成 objectURL，浏览器按需读取 */
export function triggerFileDownload(file: File, fileName: string): void {
  const objectUrl = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
}

export interface SingleFileStreamOptions {
  taskId: string;
  fileName: string;
  mimeType: string;
  body: ReadableStream<Uint8Array> | null;
  fallbackBlob: Blob | null;
  isActive: () => boolean;
  onProgress: (loaded: number, speedBps: number) => void;
}

/** 单文件下载：流式写入 OPFS，不把整个文件堆进内存 */
export async function writeSingleFileStreaming(
  options: SingleFileStreamOptions,
): Promise<{ file?: File; blob?: Blob }> {
  if (supportsOpfs() && options.body) {
    try {
      const root = await getOpfsRoot();
      const fileHandle = await root.getFileHandle(
        fileKey(options.taskId, options.fileName),
        { create: true },
      );
      const writable = await fileHandle.createWritable();
      let loaded = 0;
      let windowBytes = 0;
      let windowStart = Date.now();
      const reader = options.body.getReader();
      try {
        while (options.isActive()) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          // FileSystemWriteChunkType 要求 ArrayBuffer 支撑，复制到独立 buffer
          await writable.write(new Uint8Array(value).buffer as ArrayBuffer);
          loaded += value.byteLength;
          windowBytes += value.byteLength;
          const now = Date.now();
          if (now - windowStart >= 1000) {
            options.onProgress(
              loaded,
              (windowBytes * 1000) / (now - windowStart),
            );
            windowBytes = 0;
            windowStart = now;
          }
        }
      } finally {
        await writable.close();
        if (!options.isActive()) reader.cancel().catch(() => {});
      }
      return { file: await fileHandle.getFile() };
    } catch (error) {
      console.warn('[download-stream] 单文件 OPFS 写入失败，回退内存:', error);
    }
  }

  if (options.body) {
    const reader = options.body.getReader();
    const parts: BlobPart[] = [];
    let loaded = 0;
    while (options.isActive()) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      parts.push(value.slice());
      loaded += value.byteLength;
      options.onProgress(loaded, 0);
    }
    return { blob: new Blob(parts, { type: options.mimeType }) };
  }

  return {
    blob: options.fallbackBlob || new Blob([], { type: options.mimeType }),
  };
}

/** 删除 OPFS 中已完成的文件，释放磁盘空间 */
export async function removeOpfsFile(
  taskId: string,
  fileName: string,
): Promise<void> {
  if (!supportsOpfs()) return;
  try {
    const root = await getOpfsRoot();
    await root.removeEntry(fileKey(taskId, fileName));
  } catch {
    // 文件不存在或不支持，忽略
  }
}

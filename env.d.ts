/// <reference types="vite/client" />

declare module '*.less' {
  const resource: { [key: string]: string }
  export = resource
}

/**
 * File System Access API 补充声明。
 * TypeScript 内置 lib.dom 已包含基础接口，但缺少迭代器、权限与删除方法，
 * 这里通过接口合并补齐（非模块化 .d.ts，interface 会与全局声明合并）。
 */
interface FileSystemHandle {
  remove(options?: { recursive?: boolean }): Promise<void>
  queryPermission?(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission?(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
}

interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>
  values(): AsyncIterableIterator<FileSystemHandle>
}

interface Window {
  showDirectoryPicker?(options?: {
    mode?: 'read' | 'readwrite'
  }): Promise<FileSystemDirectoryHandle>
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  fallbackError?: string;
}

export interface HostUser {
  id: number;
  displayName: string;
  isAdmin: boolean;
  apps: string[];
  permissions: string[];
}

export interface HostSession {
  status: 'loading' | 'ready' | 'locked' | 'signed-out';
  generation: number;
  user?: HostUser;
}

export interface PickedPlatformFile {
  fileId: string;
  name: string;
  mediaType: string;
  size: number;
  url: string;
  expiresAt: number;
}

export interface SavedPlatformFile {
  fileId: string;
  name: string;
  mediaType: string;
  size: number;
  width?: number;
  height?: number;
  refKey?: string;
}

export interface OsHost {
  getSession(): HostSession;
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  upload<T>(path: string, body: FormData, options?: RequestOptions): Promise<T>;
  readBlob(path: string, options?: RequestOptions): Promise<Blob>;
  requestEvents(
    path: string,
    options: RequestOptions,
    onEvent: (event: string, data: unknown) => void,
  ): Promise<void>;
  uuid(): string;
  openApp(id: string, params?: Record<string, unknown>): boolean;
  openPublicSite(path?: string): Promise<void>;
  pickPlatformFile(): Promise<PickedPlatformFile | null>;
  savePlatformFile(file: File | Blob, name?: string, refKey?: string): Promise<SavedPlatformFile>;
  fileLibrary: {
    changed(): void;
  };
}

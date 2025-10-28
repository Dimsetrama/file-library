export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  createdTime?: string;
  size?: string;
  webViewLink?: string;
};

export type SearchResult = {
  id: string;
  name: string;
  snippet: string;
  pageNumber: number;
};

export type IndexStatus = 'checking' | 'uptodate' | 'outdated' | 'none';

export type IndexStatusInfo = {
  status: IndexStatus;
  message: string;
};

export type SearchIndex = {
  [fileId: string]: {
    name: string;
    pages: { pageNumber: number; content: string }[];
  };
};
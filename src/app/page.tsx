// src/app/page.tsx

'use client';

import { useState, useEffect, FormEvent, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import AuthButton from '@/components/AuthButton';
import Link from 'next/link';

// NOTE: These imports are no longer needed on the homepage, but we can leave them
import * as pdfjs from 'pdfjs-dist';
import mammoth from 'mammoth';
import JSZip from 'jszip';

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.mjs`;

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  createdTime?: string;
  size?: string;
};
type SearchResult = { id: string; name: string; snippet: string; pageNumber: number; };

async function extractPptxText(buffer: ArrayBuffer): Promise<string> {
    const zip = await JSZip.loadAsync(buffer);
    const slideFiles = Object.keys(zip.files).filter(f => f.startsWith("ppt/slides/") && f.endsWith(".xml"));
    let fullText = "";
    for (const slideFile of slideFiles) {
        const content = await zip.files[slideFile].async("string");
        const textNodes = content.match(/>(.*?)</g) || [];
        fullText += textNodes.map(node => node.replace(/>|</g, "")).join(" ");
    }
    return fullText;
}

export default function Home() {
  const { data: session } = useSession();
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexStatus, setIndexStatus] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);

  // State for the recent files list
  const [recentFiles, setRecentFiles] = useState<DriveFile[]>([]);
  const [isRecentFilesLoading, setIsRecentFilesLoading] = useState(false);
  const [recentFilesSearch, setRecentFilesSearch] = useState('');
  const [pageTokens, setPageTokens] = useState<(string | undefined)[]>([undefined]);
  const [recentFilesCurrentPage, setRecentFilesCurrentPage] = useState(1);

  const performSearch = async (page = 1) => {
    if (!searchQuery) return;
    setIsSearching(true);
    setHasSearched(true); 
    setSearchResults([]);
    setCurrentPage(page);
    try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}&page=${page}`);
        const data = await response.json();
        setSearchResults(data.results || []);
        setTotalPages(data.totalPages || 0);
    } catch (error) {
        console.error('Search failed:', error);
    }
    setIsSearching(false);
  };

  const handleSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    performSearch(1);
  };

const handleBuildIndex = async () => {
    setIsIndexing(true);
    setIndexStatus('Step 1/3: Fetching all files from Google Drive...');
    try {
      // CHANGED: This now calls our new API endpoint
      const listRes = await fetch('/api/drive/get-all-files');
      const fileListData = await listRes.json();
      const filesToIndex: DriveFile[] = fileListData.files || [];
      
      if (filesToIndex.length === 0) {
          setIndexStatus('No files found to index.');
          setIsIndexing(false);
          return;
      }

      setIndexStatus(`Step 2/3: Processing ${filesToIndex.length} files...`);
      const searchIndex: { [fileId: string]: { name: string, pages: {pageNumber: number, content: string}[] } } = {};

      for (const file of filesToIndex) {
        setIndexStatus(`Step 2/3: Processing ${file.name}...`);
        try {
            const response = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
                headers: { 'Authorization': `Bearer ${session?.accessToken}` }
            });
            if (!response.ok) continue;

            const arrayBuffer = await response.arrayBuffer();
            const pages: {pageNumber: number, content: string}[] = [];

            if (file.mimeType === 'application/pdf') {
                const doc = await pdfjs.getDocument(arrayBuffer).promise;
                for (let i = 1; i <= doc.numPages; i++) {
                    const page = await doc.getPage(i);
                    const content = await page.getTextContent();
                    const textItems: { str: string }[] = [];
                    content.items.forEach((item: unknown) => {
                        if (typeof item === 'object' && item !== null && 'str' in item) {
                            textItems.push(item as { str: string });
                        }
                    });
                    const pageText = textItems.map(item => item.str).join(" ");
                    pages.push({ pageNumber: i, content: pageText });
                }
            } else if (file.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
                const docxResult = await mammoth.extractRawText({ arrayBuffer });
                pages.push({ pageNumber: 1, content: docxResult.value });
            } else if (file.mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
                const pptxText = await extractPptxText(arrayBuffer);
                pages.push({ pageNumber: 1, content: pptxText });
            }

            if (pages.length > 0) {
              searchIndex[file.id] = { name: file.name, pages: pages };
            }
        } catch (processError) {
            console.error(`Skipping file ${file.name} due to error:`, processError);
        }
      }

      setIndexStatus('Step 3/3: Saving index to Google Drive...');
      const saveRes = await fetch('/api/drive/save-index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(searchIndex),
      });
      if (!saveRes.ok) throw new Error('Failed to save index.');
      
      const result = await saveRes.json();
      setIndexStatus(result.message || `Successfully indexed ${Object.keys(searchIndex).length} files!`);

    } catch (error) {
      console.error('Failed to build index:', error);
      setIndexStatus('An error occurred. Check the console for details.');
    }
    setIsIndexing(false);
  };
  
  const fetchRecentFiles = useCallback((page: number) => {
    if (session) {
      setIsRecentFilesLoading(true);
      setRecentFilesCurrentPage(page);
      
      const pageToken = pageTokens[page - 1];
      const url = new URL('/api/drive/files', window.location.origin);
      if (pageToken) url.searchParams.append('pageToken', pageToken);
      if (recentFilesSearch) url.searchParams.append('q', recentFilesSearch);

      fetch(url.toString())
        .then(res => res.json())
        .then(data => {
            setRecentFiles(data.files || []);
            const newPageTokens = [...pageTokens.slice(0, page)];
            if (data.nextPageToken) {
              newPageTokens[page] = data.nextPageToken;
            }
            setPageTokens(newPageTokens);
            setIsRecentFilesLoading(false);
        });
    }
  }, [session, recentFilesSearch, pageTokens]);

  const handleRecentFilesSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    setPageTokens([undefined]);
    fetchRecentFiles(1);
  };

  useEffect(() => {
    if (session) {
      handleRecentFilesSearchSubmit({ preventDefault: () => {} } as FormEvent);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const formatFileSize = (bytesStr?: string): string => {
    if (!bytesStr) return '-';
    const bytes = Number(bytesStr);
    if (isNaN(bytes) || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <main className="flex min-h-screen flex-col items-center p-24">
      <div className="absolute top-5 right-5">
        <AuthButton />
      </div>

      <div className="text-center w-full max-w-4xl">
        <h1 className="text-4xl font-bold mb-8">Welcome to Your File Library</h1>
        
        {session && (
            <div className="mb-8 p-4 border border-gray-700 rounded-lg">
                <button
                    onClick={handleBuildIndex}
                    disabled={isIndexing}
                    className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded disabled:bg-gray-500"
                >
                    {isIndexing ? 'Indexing...' : 'Re-Build Search Index'}
                </button>
                <p className="text-sm text-gray-400 mt-2 h-4">{indexStatus}</p>
            </div>
        )}

        {session && (
            <div className="w-full mb-12">
                <form onSubmit={handleSearchSubmit}>
                    <input
                        type="search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search for content in your files..."
                        className="w-full px-4 py-2 text-lg text-white bg-gray-800 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </form>

                {isSearching && <p className="mt-4">Searching...</p>}
                
                {hasSearched && !isSearching && searchResults.length === 0 && (
                    <div className="mt-6 text-gray-400">
                        <p>No results found for &quot;{searchQuery}&quot;.</p>
                    </div>
                )}
                
                {searchResults.length > 0 && (
                    <div className="mt-6 text-left">
                        <h3 className="text-xl mb-2">Search Results:</h3>
                        <ul className="bg-gray-800 p-4 rounded-md">
                            {searchResults.map((result) => (
                                <Link href={`/view/${result.id}?page=${result.pageNumber}&query=${encodeURIComponent(searchQuery)}`} key={result.id} target="_blank" rel="noopener noreferrer">
                                    <li className="border-b border-gray-700 py-3 hover:bg-gray-700 transition-colors cursor-pointer">
                                        <h4 className="font-bold">📄 {result.name}</h4>
                                        <p 
                                            className="text-sm text-gray-400 mt-1" 
                                            dangerouslySetInnerHTML={{ __html: result.snippet.replace(new RegExp(searchQuery, "gi"), (match) => `<strong class="text-yellow-400">${match}</strong>`) }}
                                        ></p>
                                    </li>
                                </Link>
                            ))}
                        </ul>
                        {totalPages > 1 && (
                            <div className="flex justify-center items-center gap-2 mt-6">
                                <button onClick={() => performSearch(currentPage - 1)} disabled={currentPage <= 1} className="px-3 py-1 bg-gray-700 rounded disabled:opacity-50">
                                    ← Previous
                                </button>
                                <span className="text-gray-400">
                                    Page {currentPage} of {totalPages}
                                </span>
                                <button onClick={() => performSearch(currentPage + 1)} disabled={currentPage >= totalPages} className="px-3 py-1 bg-gray-700 rounded disabled:opacity-50">
                                    Next →
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        )}

        {session ? (
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl">Your Google Drive Files:</h2>
              <form onSubmit={handleRecentFilesSearchSubmit} className="flex gap-2">
                <input
                  type="search"
                  value={recentFilesSearch}
                  onChange={(e) => setRecentFilesSearch(e.target.value)}
                  placeholder="Search files by name..."
                  className="px-3 py-1 text-sm text-white bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button type="submit" className="px-3 py-1 text-sm bg-blue-600 rounded-md hover:bg-blue-700">Search</button>
              </form>
            </div>

            {isRecentFilesLoading ? <p>Loading files...</p> : (
              <ul className="text-left bg-gray-800 p-4 rounded-md">
                {recentFiles.length > 0 ? (
                  recentFiles.map((file) => (
                    <li key={file.id} className="grid grid-cols-1 md:grid-cols-3 items-center gap-4 border-b border-gray-700 py-3 last:border-b-0">
                      <span className="md:col-span-2 truncate font-medium">📄 {file.name}</span>
                      <div className="text-left md:text-right text-sm text-gray-400">
                        <span>{formatFileSize(file.size)}</span>
                        <span className="ml-4">{file.createdTime ? new Date(file.createdTime).toLocaleDateString() : ''}</span>
                      </div>
                    </li>
                  ))
                ) : ( <p className="text-center text-gray-400">No files found.</p> )}
              </ul>
            )}

            <div className="flex justify-center items-center gap-4 mt-4">
              <button 
                onClick={() => fetchRecentFiles(recentFilesCurrentPage - 1)} 
                disabled={recentFilesCurrentPage <= 1 || isRecentFilesLoading} 
                className="px-4 py-2 bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                ← Previous
              </button>
              <span className="text-gray-400">Page {recentFilesCurrentPage}</span>
              <button 
                onClick={() => fetchRecentFiles(recentFilesCurrentPage + 1)} 
                disabled={!pageTokens[recentFilesCurrentPage] || isRecentFilesLoading} 
                className="px-4 py-2 bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next →
              </button>
            </div>
          </div>
        ) : ( <p>Please sign in to view your files.</p> )}
      </div>
    </main>
  );
}
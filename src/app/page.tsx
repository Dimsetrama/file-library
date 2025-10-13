// src/app/page.tsx
'use client';

import { useState, useEffect, FormEvent, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import AuthButton from '@/components/AuthButton';
import Link from 'next/link';
import Hamster from '@/components/Hamster';

// --- TYPE DEFINITIONS ---
type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  createdTime?: string;
  size?: string;
  webViewLink?: string;
};
type SearchResult = { id: string; name: string; snippet: string; pageNumber: number; };
type IndexStatusInfo = {
  status: 'checking' | 'uptodate' | 'outdated' | 'none';
  message: string;
};

// --- COMPONENT DEFINITION ---
export default function Home() {
  // --- STATE DECLARATIONS ---
  const { data: session } = useSession();
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexBuildStatus, setIndexBuildStatus] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [indexStatusInfo, setIndexStatusInfo] = useState<IndexStatusInfo>({ status: 'checking', message: 'Checking index status...' });
  const [recentFiles, setRecentFiles] = useState<DriveFile[]>([]);
  const [isRecentFilesLoading, setIsRecentFilesLoading] = useState(false);
  const [recentFilesSearch, setRecentFilesSearch] = useState('');
  const [pageTokens, setPageTokens] = useState<(string | undefined)[]>([undefined]);
  const [recentFilesCurrentPage, setRecentFilesCurrentPage] = useState(1);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // --- HAMSTER STATES ---
  const [showWigglingHamster, setShowWigglingHamster] = useState(true);
  const [isWigglingHamsterExploding, setIsWigglingHamsterExploding] = useState(false);
  const [showRespawnHamster, setShowRespawnHamster] = useState(false);
  const [isRespawnHamsterSquished, setIsRespawnHamsterSquished] = useState(false);
  const [showPatMeBubble, setShowPatMeBubble] = useState(false);
  const [activeHamster, setActiveHamster] = useState<'spinning' | 'dancing'>('spinning');
  const [isHamsterVisible, setIsHamsterVisible] = useState(true);

  // --- CORE LOGIC FUNCTIONS ---

  const checkIndexStatus = useCallback(async (driveFiles: DriveFile[]) => {
    setIndexStatusInfo({ status: 'checking', message: 'Verifying index status...'});
    try {
      const metaRes = await fetch('/api/drive/get-metadata');
      
      let latestFileTime: string | null = null;
      if (driveFiles.length > 0) {
        const contentFiles = driveFiles.filter(file => file.name !== 'search_index.json');
        if (contentFiles.length > 0) {
          latestFileTime = contentFiles.reduce((latest, file) => {
            const fileTime = file.createdTime;
            return (fileTime && fileTime > latest) ? fileTime : latest;
          }, contentFiles[0].createdTime || '');
        }
      }

      let lastBuildTime: string | null = null;
      let isVerified = false;

      if (metaRes.ok) {
        const metaData = await metaRes.json();
        lastBuildTime = metaData.lastBuildTime;
        isVerified = true;
        // Sync the authoritative time from the server to local storage
        localStorage.setItem('lastBuildTimeLocal', lastBuildTime as string);
      } else {
        // If the server check fails, fall back to the local copy
        lastBuildTime = localStorage.getItem('lastBuildTimeLocal');
      }
      
      if (!lastBuildTime) {
        setIndexStatusInfo({ status: 'none', message: 'Index not found. Please build the index.' });
        return;
      }

      if (latestFileTime && new Date(latestFileTime) > new Date(lastBuildTime)) {
        setIndexStatusInfo({ status: 'outdated', message: 'New files detected. Please re-build the index.' });
      } else {
        const statusMessage = `Index is up to date ${isVerified ? '' : '(unverified)'}. Last build: ${new Date(lastBuildTime).toLocaleDateString()}`;
        setIndexStatusInfo({ status: 'uptodate', message: statusMessage });
      }
    } catch (error) {
      console.error("Could not perform index status check:", error);
      setIndexStatusInfo({ status: 'none', message: 'Error checking index status.' });
    }
  }, []);

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
          const files: DriveFile[] = data.files || [];
          setRecentFiles(files);
          setPageTokens(prevTokens => {
            const newPageTokens = [...prevTokens];
            newPageTokens[page] = data.nextPageToken || undefined;
            return newPageTokens;
          });
        })
        .catch(error => console.error("Failed to fetch recent files:", error))
        .finally(() => setIsRecentFilesLoading(false));
    }
  }, [session, pageTokens, recentFilesSearch]);

  const pollIndexStatus = useCallback(() => {
    if (pollingIntervalRef.current) { clearInterval(pollingIntervalRef.current); }
    pollingIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/drive/indexing-status');
        const data = await res.json();
        if (data.status === 'processing') {
          const percentage = data.total > 0 ? Math.round((data.progress / data.total) * 100) : 0;
          setIndexBuildStatus(`Processing file ${data.progress} of ${data.total} (${percentage}%)...`);
        } else if (data.status === 'complete' || data.status === 'error') {
          if (pollingIntervalRef.current) { clearInterval(pollingIntervalRef.current); }
          setIndexBuildStatus(data.message);
          setIsIndexing(false);
          if(data.status === 'complete') {
            localStorage.setItem('lastBuildTimeLocal', new Date().toISOString());
          }
          fetchRecentFiles(1);
        }
      } catch (error) {
        console.error("Polling error:", error);
        if (pollingIntervalRef.current) { clearInterval(pollingIntervalRef.current); }
      }
    }, 3000);
  }, [fetchRecentFiles]);

  const handleBuildIndex = async () => {
    setIsIndexing(true);
    setIndexBuildStatus('Requesting index build...');
    try {
      const response = await fetch('/api/drive/build-index', { method: 'POST' });
      const result = await response.json();
      if (!response.ok) { throw new Error(result.message || 'Failed to start index process.'); }
      pollIndexStatus();
    } catch (error) {
      setIndexBuildStatus(error instanceof Error ? error.message : 'An unknown error occurred.');
      setIsIndexing(false);
    }
  };
  
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
  
  // --- EVENT HANDLERS ---
  const handleRecentFilesSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    setPageTokens([undefined]); // Reset pagination for new search
    fetchRecentFiles(1);
  };

  const handleSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    performSearch(1);
  };

  const formatFileSize = (bytesStr?: string): string => {
    if (!bytesStr) return '-';
    const bytes = Number(bytesStr);
    if (isNaN(bytes) || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleHamsterClick = () => {
    setIsHamsterVisible(false);
    setTimeout(() => {
      setActiveHamster(prev => prev === 'spinning' ? 'dancing' : 'spinning');
      setIsHamsterVisible(true);
    }, 300);
  };

  const handleWigglingHamsterClick = () => {
    setIsWigglingHamsterExploding(true);
    setTimeout(() => {
      setShowWigglingHamster(false);
      setShowRespawnHamster(true);
    }, 500);
  };

  const handleRespawnClick = () => {
    if (isRespawnHamsterSquished) return;
    setIsRespawnHamsterSquished(true);
    setTimeout(() => {
      setShowRespawnHamster(false);
      setShowWigglingHamster(true);
      setIsWigglingHamsterExploding(false);
      setIsRespawnHamsterSquished(false);
    }, 1000);
  };

  // --- SIDE EFFECTS (HOOKS) ---
  useEffect(() => {
    if (session) {
      // This dependency array is intentionally simple. We only want this to run
      // once when the session loads. `fetchRecentFiles` will not cause a loop.
      fetchRecentFiles(1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    // This hook runs whenever the file list is updated, triggering the status check.
    if (session && recentFiles.length > 0) { 
      checkIndexStatus(recentFiles); 
    }
  }, [session, recentFiles, checkIndexStatus]);

  // --- RENDER LOGIC ---
  const statusDotColor = {
    checking: 'bg-gray-400',
    uptodate: 'bg-green-500',
    outdated: 'bg-yellow-500',
    none: 'bg-red-500',
  };

  return (
    <div className="relative min-h-screen bg-black">
      <main className="flex flex-col items-center p-24">
        <div className="absolute top-5 right-5 z-20">
          <AuthButton />
        </div>
        <div className="text-center w-full max-w-4xl">
          <h1 className="text-4xl font-bold mb-8 flex items-center justify-center gap-4">
            <div 
              className="relative"
              onMouseEnter={() => setShowPatMeBubble(true)}
              onMouseLeave={() => setShowPatMeBubble(false)}
            >
              {showWigglingHamster && (
                  <div 
                    onClick={handleWigglingHamsterClick} 
                    className={`cursor-pointer ${isWigglingHamsterExploding ? 'animate-explode' : ''}`}
                  >
                    <Hamster gif="wiggling" size={64} />
                  </div>
              )}
              {showPatMeBubble && (
                  <div className="speech-bubble bg-gray-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg">
                    PAT ME!!!
                  </div>
              )}
            </div>
            Welcome to Etrama&apos;s Library
          </h1>

          {session && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
                <div className="md:col-span-2 p-4 border border-gray-700 rounded-lg">
                  <button
                    onClick={handleBuildIndex}
                    disabled={isIndexing}
                    className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded disabled:bg-gray-500"
                  >
                    {isIndexing ? 'Indexing...' : 'Re-Build Search Index'}
                  </button>
                  <p className="text-sm text-gray-400 mt-2 h-4">{indexBuildStatus}</p>
                </div>
                <div className="p-4 border border-gray-700 rounded-lg flex items-center gap-3">
                    <span className={`w-4 h-4 rounded-full flex-shrink-0 ${statusDotColor[indexStatusInfo.status]}`}></span>
                    <p className="text-sm text-gray-300 text-left">{indexStatusInfo.message}</p>
                </div>
              </div>
              
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
                        <Link href={`/view/${result.id}?page=${result.pageNumber}&query=${encodeURIComponent(searchQuery)}`} key={`${result.id}-${result.pageNumber}`} target="_blank" rel="noopener noreferrer">
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
                      recentFiles.map((file) => {
                        const isViewableInApp = file.mimeType === 'application/pdf';
                        const fileContent = (
                          <div className="grid grid-cols-1 md:grid-cols-3 items-center gap-4 w-full">
                            <span className="md:col-span-2 truncate font-medium">📄 {file.name}</span>
                            <div className="text-left md:text-right text-sm text-gray-400">
                              <span>{formatFileSize(file.size)}</span>
                              <span className="ml-4">{file.createdTime ? new Date(file.createdTime).toLocaleDateString() : ''}</span>
                            </div>
                          </div>
                        );
                        return (
                          <li key={file.id} className="border-b border-gray-700 last:border-b-0">
                            {isViewableInApp ? (
                              <Link href={`/view/${file.id}`} target="_blank" rel="noopener noreferrer" className="block py-3 px-2 hover:bg-gray-700 transition-colors">
                                {fileContent}
                              </Link>
                            ) : (
                              <a href={file.webViewLink} target="_blank" rel="noopener noreferrer" className="block py-3 px-2 hover:bg-gray-700 transition-colors">
                                {fileContent}
                              </a>
                            )}
                          </li>
                        );
                      })
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
                    disabled={isRecentFilesLoading || !pageTokens[recentFilesCurrentPage]}
                    className="px-4 py-2 bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next →
                  </button>
                </div>
              </div>
            </>
          )}
          {!session && <p>Please sign in to view your files.</p>}
        </div>
      </main>
      <div 
        onClick={handleHamsterClick}
        className={`cursor-pointer fixed bottom-4 z-50 transition-all duration-300 ease-in-out ${
          activeHamster === 'spinning' ? 'left-4' : 'right-4'
        } ${
          isHamsterVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-50'
        }`}
      >
        <Hamster 
          gif={activeHamster}
          size={80} 
        />
      </div>
      {showRespawnHamster && (
        <div 
          onClick={handleRespawnClick} 
          className={`cursor-pointer absolute bottom-4 z-20 left-1/2 -translate-x-1/2 ${
            isRespawnHamsterSquished ? 'animate-squish-tremor' : ''
          }`}
        >
          <Hamster gif="head" size={64} />
        </div>
      )}
    </div>
  );
}

 
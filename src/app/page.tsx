// src/app/page.tsx

'use client';

import { useState, useEffect, FormEvent, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import AuthButton from '@/components/AuthButton';
import Link from 'next/link';
import Hamster from '@/components/Hamster';

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  createdTime?: string;
  size?: string;
};
type SearchResult = { id: string; name: string; snippet: string; pageNumber: number; };
type IndexStatusInfo = {
    status: 'checking' | 'uptodate' | 'outdated' | 'none';
    message: string;
};

export default function Home() {
  const { data: session } = useSession();
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexBuildStatus, setIndexBuildStatus] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);

  const [showWigglingHamster, setShowWigglingHamster] = useState(true);
  const [isWigglingHamsterExploding, setIsWigglingHamsterExploding] = useState(false);
  const [showRespawnHamster, setShowRespawnHamster] = useState(false);
  const [isRespawnHamsterSquished, setIsRespawnHamsterSquished] = useState(false);
  const [showPatMeBubble, setShowPatMeBubble] = useState(false);
  const [activeHamster, setActiveHamster] = useState<'spinning' | 'dancing'>('spinning');
  const [isHamsterVisible, setIsHamsterVisible] = useState(true);
  const [indexStatusInfo, setIndexStatusInfo] = useState<IndexStatusInfo>({ status: 'checking', message: 'Checking index status...' });

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
    setIndexBuildStatus('Step 1/3: Fetching all files...');
    try {
      const pdfjs = await import('pdfjs-dist');
      const mammoth = (await import('mammoth')).default;
      const JSZip = (await import('jszip')).default;

      pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.mjs`;

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

      const listRes = await fetch('/api/drive/get-all-files');
      const fileListData = await listRes.json();
      const filesToIndex: DriveFile[] = fileListData.files || [];
      if (filesToIndex.length === 0) {
        setIndexBuildStatus('No files found to index.');
        setIsIndexing(false);
        return;
      }
      setIndexBuildStatus(`Step 2/3: Processing ${filesToIndex.length} files...`);
      const searchIndex: { [fileId: string]: { name: string, pages: {pageNumber: number, content: string}[] } } = {};
      for (const file of filesToIndex) {
        setIndexBuildStatus(`Step 2/3: Processing ${file.name}...`);
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
 setIndexBuildStatus('Step 3/3: Saving index to Google Drive...');
      const saveRes = await fetch('/api/drive/save-index', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(searchIndex) 
      });
      if (!saveRes.ok) throw new Error('Failed to save index.');
      const result = await saveRes.json();

      // --- START: NEW CODE TO SAVE TIMESTAMP ---
      setIndexBuildStatus('Step 4/4: Finalizing build metadata...');
      const now = new Date().toISOString();
      await fetch('/api/drive/save-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastIndexTime: now })
      });
      // --- END: NEW CODE ---

              // --- NEW: Also save to localStorage as a fallback ---
        localStorage.setItem('lastIndexTime', now);
        // --- END NEW ---

      setIndexBuildStatus(result.message || `Successfully indexed ${Object.keys(searchIndex).length} files!`);
      
      setIndexBuildStatus(result.message || `Successfully indexed ${Object.keys(searchIndex).length} files!`);
      
      // Update the bulletin immediately
      setIndexStatusInfo({ status: 'uptodate', message: `Index is up to date. Last build: ${new Date(now).toLocaleString()}` });

    } catch (error) {
      console.error('Failed to build index:', error);
      setIndexBuildStatus('An error occurred. Check the console for details.');
    }
    setIsIndexing(false);
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
    }, 1500);
  };
// Define this above your other functions, near your useState declarations
const checkIndexStatusRef = useRef<((driveFiles: DriveFile[]) => Promise<void>) | null>(null);

const checkIndexStatus = useCallback(async (driveFiles: DriveFile[]) => {
    setIndexStatusInfo({ status: 'checking', message: 'Verifying index status...'});

    try {
        const metaRes = await fetch('/api/drive/get-metadata');

        // Find the most recent modification date from the files list we already have.
        let latestFileTime: string | null = null;
        if (driveFiles.length > 0) {
            latestFileTime = driveFiles.reduce((latest, file) => {
                const fileTime = file.createdTime; // Using createdTime for consistency
                return (fileTime && fileTime > latest) ? fileTime : latest;
            }, driveFiles[0].createdTime || '');
        }

        let lastBuildTime: string | null = null;
        let isVerified = false;
        
        if (metaRes.ok) {
            const metaData = await metaRes.json();
            lastBuildTime = metaData.lastIndexTime;
            isVerified = true;
        } else {
            lastBuildTime = localStorage.getItem('lastIndexTime');
        }

        if (!lastBuildTime) {
            setIndexStatusInfo({ status: 'none', message: 'No search index found. Please build the index.' });
            return;
        }

        if (latestFileTime && new Date(latestFileTime) > new Date(lastBuildTime)) {
            setIndexStatusInfo({ status: 'outdated', message: 'New files detected. Please re-build the index.' });
        } else {
            const statusMessage = `Index is up to date ${isVerified ? '(verified)' : '(unverified)'}. Last build: ${new Date(lastBuildTime).toLocaleDateString()}`;
            setIndexStatusInfo({ status: 'uptodate', message: statusMessage });
        }

    } catch (error) {
        console.error("Could not perform index status check:", error);
        setIndexStatusInfo({ status: 'none', message: 'Error checking index status. Please try again.' });
    }
}, []);

checkIndexStatusRef.current = checkIndexStatus;
  
 // In src/app/page.tsx

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
                
                const newPageTokens = [...pageTokens.slice(0, page)];
                if (data.nextPageToken) {
                    newPageTokens[page] = data.nextPageToken;
                }
                setPageTokens(newPageTokens);
                setIsRecentFilesLoading(false);

                // --- NEW: Call the check with the fresh file list ---
                checkIndexStatus(files);
            });
    }
// You must add checkIndexStatus to the dependency array
}, [session, recentFilesSearch, pageTokens, checkIndexStatus]);

  const handleRecentFilesSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    setPageTokens([undefined]);
    fetchRecentFiles(1);
  };

  const statusDotColor = {
    checking: 'bg-gray-400',
    uptodate: 'bg-green-500',
    outdated: 'bg-yellow-500',
    none: 'bg-red-500',
  };

// In src/app/page.tsx

// In src/app/page.tsx

useEffect(() => {
    const checkStatus = checkIndexStatusRef.current;

    // This function now has a stable reference from the ref
    const fetchFilesAndCheckStatus = () => {
        if (session) {
            setIsRecentFilesLoading(true);
            const url = new URL('/api/drive/files', window.location.origin);
            
            fetch(url.toString())
                .then(res => res.json())
                .then(data => {
                    const files: DriveFile[] = data.files || [];
                    setRecentFiles(files);
                    setIsRecentFilesLoading(false);
                    
                    // Call the status check using the stable reference
                    if (checkStatus) {
                        checkStatus(files);
                    }
                });
        }
    };

    fetchFilesAndCheckStatus();
    
}, [session]); // The dependency array is now stable, breaking the loop.

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
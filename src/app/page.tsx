// src/app/page.tsx

'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useSession } from 'next-auth/react';
import AuthButton from '@/components/AuthButton';
import * as pdfjs from 'pdfjs-dist';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import Link from 'next/link';

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.mjs`;

type DriveFile = { id: string; name: string; mimeType: string; };
// CHANGED: SearchResult now includes a pageNumber
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
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexStatus, setIndexStatus] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const handleSearch = async (e: FormEvent) => {
    e.preventDefault();
    if (!searchQuery) return;
    setIsSearching(true);
    setSearchResults([]);
    try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
        const data = await response.json();
        console.log('Data received from search API:', data);
        setSearchResults(data.results || []);
    } catch (error) {
        console.error('Search failed:', error);
    }
    setIsSearching(false);
  };

  // CHANGED: This entire function is updated to build the page-based index
  const handleBuildIndex = async () => {
    setIsIndexing(true);
    setIndexStatus('Step 1/3: Fetching file list...');
    try {
      const listRes = await fetch('/api/drive/files');
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
  
  useEffect(() => {
    if (session) {
      setIsLoading(true);
      fetch('/api/drive/files').then(res => res.json()).then(data => {
          setFiles(data.files || []);
          setIsLoading(false);
        });
    }
  }, [session]);

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
                <form onSubmit={handleSearch}>
                    <input
                        type="search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search for content in your files..."
                        className="w-full px-4 py-2 text-lg text-white bg-gray-800 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </form>

                {isSearching && <p className="mt-4">Searching...</p>}
                
                {searchResults.length > 0 && (
                    <div className="mt-6 text-left">
                        <h3 className="text-xl mb-2">Search Results:</h3>
                        <ul className="bg-gray-800 p-4 rounded-md">
                            {searchResults.map((result) => (
                                // CHANGED: The link now includes the page number
                                <Link href={`/view/${result.id}?page=${result.pageNumber}`} key={result.id}>
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
                    </div>
                )}
            </div>
        )}

        {session ? (
          <div>
            <h2 className="text-2xl mb-4">Your Recent Google Drive Files:</h2>
            {isLoading ? <p>Loading files...</p> : (
              <ul className="text-left bg-gray-800 p-4 rounded-md">
                {files.length > 0 ? (
                  files.map((file) => (
                    <li key={file.id} className="border-b border-gray-700 py-2">
                      <span>📄 {file.name}</span>
                    </li>
                  ))
                ) : ( <p>No files found.</p> )}
              </ul>
            )}
          </div>
        ) : ( <p>Please sign in to view your files.</p> )}
      </div>
    </main>
  );
}
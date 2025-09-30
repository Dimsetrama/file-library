// src/app/page.tsx

'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import AuthButton from '@/components/AuthButton';
import * as pdfjs from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.mjs`;

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
};

export default function Home() {
  const { data: session } = useSession();
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isIndexing, setIsIndexing] = useState(false);
  const [processingFile, setProcessingFile] = useState<string | null>(null);

  const handleBuildIndex = async () => {
    setIsIndexing(true);
    alert('Starting to build the search index. This may take several minutes...');
    try {
        const response = await fetch('/api/drive/build-index', {
            method: 'POST',
        });
        const result = await response.json();
        alert(result.message);
    } catch (error) {
        console.error('Failed to build index:', error);
        alert('Failed to build index. See console for details.');
    }
    setIsIndexing(false);
  };

  const handleProcessFile = async (file: DriveFile) => {
    setProcessingFile(file.id);
    console.log(`Processing file: ${file.name}...`);

    try {
      if (file.mimeType === 'application/pdf') {
        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
          headers: { 'Authorization': `Bearer ${session?.accessToken}` }
        });
        if (!response.ok) throw new Error('Failed to download file from Google Drive');
        const arrayBuffer = await response.arrayBuffer();
        const doc = await pdfjs.getDocument(arrayBuffer).promise;
        let pdfText = "";
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const content = await page.getTextContent();
          
          // Using the more explicit loop to avoid the TypeScript error
          const textItems: { str: string }[] = [];
          content.items.forEach((item: unknown) => {
            if (typeof item === 'object' && item !== null && 'str' in item) {
              textItems.push(item as { str: string });
            }
          });
          const pageText = textItems.map(item => item.str).join(" ");
          pdfText += pageText + " ";
        }
        console.log(`--- Extracted Text for ${file.name} ---`);
        console.log(pdfText);
        alert(`Finished processing PDF! Check the console (F12) for the extracted text.`);
      } else {
        const res = await fetch(`/api/drive/process-file?fileId=${file.id}&mimeType=${file.mimeType}`);
        if (!res.ok) throw new Error('Server failed to process file');
        const data = await res.json();
        console.log(`--- Extracted Text for ${file.name} ---`);
        console.log(data.text);
        alert(`Finished processing! Check the console (F12) for the extracted text.`);
      }
    } catch (error) {
      console.error("Failed to process file:", error);
      alert("Failed to process file. See console for details.");
    }
    setProcessingFile(null);
  };
  
  useEffect(() => {
    if (session) {
      setIsLoading(true);
      fetch('/api/drive/files')
        .then((res) => res.json())
        .then((data) => {
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
            <div className="mb-8">
                <button
                    onClick={handleBuildIndex}
                    disabled={isIndexing}
                    className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded disabled:bg-gray-500"
                >
                    {isIndexing ? 'Indexing in Progress...' : 'Build Search Index'}
                </button>
                <p className="text-sm text-gray-400 mt-2">Click this to process all your files for searching.</p>
            </div>
        )}

        {session ? (
          <div>
            <h2 className="text-2xl mb-4">Your Recent Google Drive Files:</h2>
            {isLoading ? <p>Loading files...</p> : (
              <ul className="text-left bg-gray-800 p-4 rounded-md">
                {files.length > 0 ? (
                  files.map((file) => (
                    <li key={file.id} className="flex justify-between items-center border-b border-gray-700 py-2">
                      <span>📄 {file.name}</span>
                      <button
                        onClick={() => handleProcessFile(file)}
                        className="bg-blue-600 hover:bg-blue-700 text-white text-sm py-1 px-3 rounded"
                        disabled={!!processingFile}
                      >
                        {processingFile === file.id ? 'Processing...' : 'Process'}
                      </button>
                    </li>
                  ))
                ) : (
                  <p>No files found.</p>
                )}
              </ul>
            )}
          </div>
        ) : (
          <p>Please sign in to view your files.</p>
        )}
      </div>
    </main>
  );
}
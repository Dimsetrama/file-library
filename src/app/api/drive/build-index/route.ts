// src/app/api/drive/build-index/route.ts

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { google } from "googleapis";
import { Readable } from "stream";

// --- FIX 1: Polyfill for DOMMatrix ---
// This creates a fake DOMMatrix class on the server, preventing pdf.js from crashing.
if (typeof global.DOMMatrix === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).DOMMatrix = class DOMMatrix {};
}

// --- FIX 2: Use the main import that Vercel can find ---
import * as pdfjs from "pdfjs-dist";
import mammoth from "mammoth";
import JSZip from "jszip";

// Define a type for DriveFile to use on the server
type DriveFile = { id: string; name: string; mimeType: string; };

// Helper function to get the Google Drive service
async function getDriveService() {
    // ... (This function remains the same)
    const session = await getServerSession(authOptions);
    if (!session || !session.accessToken) {
        throw new Error("Unauthorized");
    }
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: session.accessToken });
    return google.drive({ version: "v3", auth });
}

export async function POST() {
    try {
        // --- FIX 3: Point the worker to the correct non-legacy build ---
        pdfjs.GlobalWorkerOptions.workerSrc = `pdfjs-dist/build/pdf.worker.mjs`;

        const drive = await getDriveService();

        // ... (The rest of your code from here down remains exactly the same) ...

        // 1. Get a list of all file IDs from Google Drive
        const searchQuery = `(mimeType='application/pdf' or mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document' or mimeType='application/vnd.openxmlformats-officedocument.presentationml.presentation') and trashed = false`;
        const filesResponse = await drive.files.list({
            q: searchQuery,
            fields: 'files(id, name, mimeType)',
            pageSize: 1000
        });

        const filesFromGoogle = filesResponse.data.files || [];
        const filesToIndex = filesFromGoogle.filter(
            (file): file is DriveFile => file.id != null && file.name != null && file.mimeType != null
        );

        if (filesToIndex.length === 0) {
            return NextResponse.json({ message: 'No files found to index.' });
        }

        // 2. Process each file on the server
        const searchIndex: { [fileId: string]: { name: string, pages: {pageNumber: number, content: string}[] } } = {};

        for (const file of filesToIndex) {
            try {
                const fileResponse = await drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'arraybuffer' });
                const arrayBuffer = fileResponse.data as ArrayBuffer;

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
                    const zip = await JSZip.loadAsync(arrayBuffer);
                    const slideFiles = Object.keys(zip.files).filter(f => f.startsWith("ppt/slides/") && f.endsWith(".xml"));
                    let fullText = "";
                    for (const slideFile of slideFiles) {
                        const content = await zip.files[slideFile].async("string");
                        const textNodes = content.match(/>(.*?)</g) || [];
                        fullText += textNodes.map(node => node.replace(/>|</g, "")).join(" ");
                    }
                    pages.push({ pageNumber: 1, content: fullText });
                }

                if (pages.length > 0) {
                    searchIndex[file.id] = { name: file.name, pages: pages };
                }
            } catch (processError) {
                console.error(`Skipping file ${file.name} due to error:`, processError);
            }
        }

        // 3. Save the final index file to Google Drive
        const indexContent = JSON.stringify(searchIndex);
        const searchRes = await drive.files.list({ q: `name='search_index.json' and trashed = false`, fields: 'files(id)' });
        const existingFileId = searchRes.data.files?.[0]?.id;
        const media = { mimeType: 'application/json', body: Readable.from([indexContent]) };

        if (existingFileId) {
            await drive.files.update({ fileId: existingFileId, media: media });
        } else {
            await drive.files.create({ requestBody: { name: 'search_index.json', mimeType: 'application/json' }, media: media });
        }

        // 4. Save the metadata timestamp
        const now = new Date().toISOString();
        const metaRes = await drive.files.list({ q: `name='index_metadata.json' and trashed = false`, fields: 'files(id)' });
        const metaFileId = metaRes.data.files?.[0]?.id;
        const metaMedia = { mimeType: 'application/json', body: Readable.from([JSON.stringify({ lastIndexTime: now })]) };

        if (metaFileId) {
            await drive.files.update({ fileId: metaFileId, media: metaMedia });
        } else {
            await drive.files.create({ requestBody: { name: 'index_metadata.json' }, media: metaMedia });
        }

        return NextResponse.json({ message: `Successfully indexed ${Object.keys(searchIndex).length} files!` });
        
    } catch (error) {
        console.error("Error during server-side build:", error);
        return new NextResponse(JSON.stringify({ message: "An internal server error occurred during indexing." }), { status: 500 });
    }
}

// Vercel specific configuration
export const maxDuration = 300; // 5 minutes
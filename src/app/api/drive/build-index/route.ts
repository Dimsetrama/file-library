// src/app/api/drive/build-index/route.ts

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]/route";
import { google, drive_v3 } from "googleapis";

import mammoth from "mammoth";
import JSZip from "jszip";

// THE FIX IS HERE: By putting the module name in a variable,
// we hide it from the bundler's static analysis.
const modulePath = "pdf-parse";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdf = require(modulePath);

async function extractPptxText(buffer: ArrayBuffer): Promise<string> {
    const zip = await JSZip.loadAsync(buffer);
    const slideFiles = Object.keys(zip.files).filter(filename =>
        filename.startsWith("ppt/slides/") && filename.endsWith(".xml")
    );
    let fullText = "";
    for (const slideFile of slideFiles) {
        const slideContent = await zip.files[slideFile].async("string");
        const textNodes = slideContent.match(/>(.*?)</g) || [];
        const slideText = textNodes.map(node => node.replace(/>|</g, "")).join(" ");
        fullText += slideText + "\n";
    }
    return fullText;
}

async function processFile(drive: drive_v3.Drive, file: drive_v3.Schema$File): Promise<{id: string, name: string, content: string} | null> {
    if (!file.id || !file.name || !file.mimeType) return null;

    console.log(`Processing ${file.name}...`);
    try {
        const fileResponse = await drive.files.get(
            { fileId: file.id, alt: "media" },
            { responseType: "arraybuffer" }
        );
        const buffer = fileResponse.data as ArrayBuffer;
        const nodeBuffer = Buffer.from(buffer);
        let extractedText = "";

        switch (file.mimeType) {
            case "application/pdf":
                const data = await pdf(nodeBuffer);
                extractedText = data.text;
                break;
            case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
                const docxResult = await mammoth.extractRawText({ buffer: nodeBuffer });
                extractedText = docxResult.value;
                break;
            case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
                extractedText = await extractPptxText(buffer);
                break;
            default:
                return null;
        }
        return { id: file.id, name: file.name, content: extractedText };
    } catch (error) {
        console.error(`Failed to process file ${file.name}:`, error);
        return null;
    }
}

export async function POST(_req: Request) {
    const session = await getServerSession(authOptions);
    if (!session || !session.accessToken) {
        return new NextResponse("Unauthorized", { status: 401 });
    }

    try {
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: session.accessToken });
        const drive = google.drive({ version: "v3", auth });

        const searchQuery = `(mimeType='application/pdf' or mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document' or mimeType='application/vnd.openxmlformats-officedocument.presentationml.presentation') and trashed = false`;
        const listRes = await drive.files.list({
            pageSize: 100,
            fields: "files(id, name, mimeType)",
            q: searchQuery,
        });

        const files = listRes.data.files;
        if (!files || files.length === 0) {
            return NextResponse.json({ message: "No files found to index." });
        }

        const processingPromises = files.map(file => processFile(drive, file));
        const processedResults = await Promise.all(processingPromises);
        
        const searchIndex: { [fileId: string]: { name: string, content: string } } = {};
        processedResults.forEach(result => {
            if (result) {
                searchIndex[result.id] = { name: result.name, content: result.content };
            }
        });
        
        const indexContent = JSON.stringify(searchIndex);

        const appDataFiles = await drive.files.list({
            spaces: 'appDataFolder',
            fields: 'files(id, name)',
        });
        const oldIndex = appDataFiles.data.files?.find(file => file.name === 'search_index.json');
        if (oldIndex && oldIndex.id) {
            await drive.files.delete({ fileId: oldIndex.id });
        }

        await drive.files.create({
            requestBody: {
                name: 'search_index.json',
                parents: ['appDataFolder']
            },
            media: {
                mimeType: 'application/json',
                body: indexContent,
            },
            fields: 'id',
        });

        return NextResponse.json({ message: `Successfully indexed ${Object.keys(searchIndex).length} files.` });
    } catch (error) {
        console.error("Error building search index:", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
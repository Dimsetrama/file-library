/* eslint-disable @typescript-eslint/no-require-imports */
const { google } = require('googleapis');
const { Readable } = require('stream');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const JSZip = require('jszip');
const fs = require('fs/promises');
const path = require('path');

const STATUS_FILE_PATH = path.join(process.cwd(), '.tmp', 'indexing-status.json');

async function updateStatus(status) {
    try {
        await fs.mkdir(path.dirname(STATUS_FILE_PATH), { recursive: true });
        await fs.writeFile(STATUS_FILE_PATH, JSON.stringify(status));
    } catch (e) {
        console.error("Failed to write status file:", e);
    }
}

async function run() {
    console.log("Starting index build script...");
    const accessToken = process.argv[2];
    if (!accessToken) {
        await updateStatus({ status: 'error', message: 'Access Token was not provided.' });
        process.exit(1);
    }

    try {
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: accessToken });
        const drive = google.drive({ version: "v3", auth });

        const searchQuery = `(mimeType='application/pdf' or mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document' or mimeType='application/vnd.openxmlformats-officedocument.presentationml.presentation') and trashed = false`;
        const filesResponse = await drive.files.list({
            q: searchQuery,
            fields: 'files(id, name, mimeType)',
            pageSize: 1000
        });

        const filesToIndex = (filesResponse.data.files || []).filter(
            (file) => file.id && file.name && file.mimeType
        );

        if (filesToIndex.length === 0) {
            await updateStatus({ status: 'complete', message: 'No new files found to index.' });
            return;
        }

        await updateStatus({ status: 'processing', progress: 0, total: filesToIndex.length });
        
        const searchIndex = {};
        for (let i = 0; i < filesToIndex.length; i++) {
            const file = filesToIndex[i];
            console.log(`Processing file ${i + 1}/${filesToIndex.length}: ${file.name}`);
            await updateStatus({ status: 'processing', progress: i + 1, total: filesToIndex.length });

            try {
                const fileResponse = await drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'arraybuffer' });
                const arrayBuffer = fileResponse.data;
                const pages = [];
                if (file.mimeType === 'application/pdf') {
                    const data = await pdfParse(Buffer.from(arrayBuffer));
                    pages.push({ pageNumber: 1, content: data.text });
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
                if (pages.length > 0) { searchIndex[file.id] = { name: file.name, pages: pages }; }
            } catch (processError) {
                console.error(`Skipping file ${file.name} due to error:`, processError.message);
            }
        }
        
        console.log("Saving search_index.json to Google Drive...");
        const indexContent = JSON.stringify(searchIndex);
        const searchRes = await drive.files.list({ q: `name='search_index.json' and trashed = false`, fields: 'files(id)' });
        const existingFileId = searchRes.data.files?.[0]?.id;
        const media = { mimeType: 'application/json', body: Readable.from([indexContent]) };
        if (existingFileId) { await drive.files.update({ fileId: existingFileId, media }); }
        else { await drive.files.create({ requestBody: { name: 'search_index.json' }, media }); }

        // --- THE FIX: SAVE TIMESTAMP TO A LOCAL FILE ---
        console.log("Saving metadata to local file...");
        const now = new Date().toISOString();
        const METADATA_PATH = path.join(process.cwd(), '.tmp', 'metadata.json');
        try {
            await fs.mkdir(path.dirname(METADATA_PATH), { recursive: true });
            await fs.writeFile(METADATA_PATH, JSON.stringify({ lastBuildTime: now }));
        } catch (e) {
            console.error("Failed to write local metadata file:", e);
        }

        await updateStatus({ status: 'complete', message: `Index build complete. Successfully indexed ${Object.keys(searchIndex).length} files.` });
        console.log(`Index build complete.`);

    } catch (error) {
        console.error("FATAL ERROR during index build script:", error.message);
        await updateStatus({ status: 'error', message: error.message });
        process.exit(1);
    }
}

run();


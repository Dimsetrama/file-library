/* eslint-disable @typescript-eslint/no-require-imports */
const { google } = require('googleapis');
const { Readable } = require('stream');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const JSZip = require('jszip');

async function run() {
    console.log("Starting index build script...");
    const accessToken = process.argv[2];
    if (!accessToken) {
        console.error("Access Token was not provided.");
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

        console.log(`Found ${filesToIndex.length} files to process.`);
        const searchIndex = {};

        for (const file of filesToIndex) {
            try {
                const fileResponse = await drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'arraybuffer' });
                const buffer = Buffer.from(fileResponse.data);
                const pages = [];

                if (file.mimeType === 'application/pdf') {
                    const options = {
                        pagerender: (pageData) => {
                            return pageData.getTextContent().then(textContent => {
                                return textContent.items.map(item => item.str).join(' ');
                            }).then(text => text + '\n<--PAGE_BREAK-->\n');
                        }
                    };
                    const data = await pdfParse(buffer, options);
                    const pageTexts = data.text.split('<--PAGE_BREAK-->').filter(text => text.trim().length > 0);
                    pageTexts.forEach((text, index) => {
                        pages.push({ pageNumber: index + 1, content: text });
                    });
                } else if (file.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
                    const docxResult = await mammoth.extractRawText({ buffer });
                    pages.push({ pageNumber: 1, content: docxResult.value });
                } else if (file.mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
                    const zip = await JSZip.loadAsync(buffer);
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
        const now = new Date().toISOString();
        
        const media = { mimeType: 'application/json', body: Readable.from([indexContent]) };
        // The timestamp is now the file's description
        const requestBody = { description: now }; 

        if (existingFileId) { 
            await drive.files.update({ fileId: existingFileId, media, requestBody });
        } else { 
            await drive.files.create({ requestBody: { name: 'search_index.json', ...requestBody }, media }); 
        }

        console.log(`Index build complete. Successfully indexed ${Object.keys(searchIndex).length} files.`);

    } catch (error) {
        console.error("FATAL ERROR during index build script:", error.message);
        process.exit(1);
    }
}
run();


// src/app/api/drive/process-file/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]/route";
import { google } from "googleapis";
import mammoth from "mammoth";
import JSZip from "jszip";

// NO PDF CODE SHOULD BE IN THIS FILE

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

export async function GET(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session || !session.accessToken) {
        return new NextResponse("Unauthorized", { status: 401 });
    }
    
    const { searchParams } = new URL(req.url);
    const fileId = searchParams.get("fileId");
    const mimeType = searchParams.get("mimeType");

    if (!fileId || !mimeType) {
        return new NextResponse("Missing fileId or mimeType", { status: 400 });
    }

    try {
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: session.accessToken });
        const drive = google.drive({ version: "v3", auth });
        
        const fileResponse = await drive.files.get(
            { fileId: fileId, alt: "media" },
            { responseType: "arraybuffer" }
        );
        const buffer = fileResponse.data as ArrayBuffer;
        const nodeBuffer = Buffer.from(buffer);
        let extractedText = "";

        switch (mimeType) {
            case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
                const docxResult = await mammoth.extractRawText({ buffer: nodeBuffer });
                extractedText = docxResult.value;
                break;
            case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
                extractedText = await extractPptxText(buffer);
                break;
            default:
                return NextResponse.json({ text: "File type not supported for processing." });
        }
        return NextResponse.json({ text: extractedText });
    } catch (error) {
        console.error("Error processing file:", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
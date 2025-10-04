// src/app/api/drive/get-metadata/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { google } from "googleapis";
import { Readable } from "stream"; // Import Readable stream type

const METADATA_FILE_NAME = 'index_metadata.json';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !session.accessToken) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: session.accessToken });
    const drive = google.drive({ version: "v3", auth });

    const searchRes = await drive.files.list({
      q: `name='${METADATA_FILE_NAME}' and trashed = false`,
      fields: 'files(id)',
    });

    const fileId = searchRes.data.files?.[0]?.id;

    if (!fileId) {
      return new NextResponse("Metadata file not found.", { status: 404 });
    }

    const fileRes = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' } // Ensure the response is a stream
    );
    
    // --- START: CORRECTED CODE TO READ THE STREAM ---
    const stream = fileRes.data as Readable;
    let content = '';
    for await (const chunk of stream) {
        content += chunk;
    }
    const data = JSON.parse(content);
    // --- END: CORRECTED CODE ---

    return NextResponse.json(data);

  } catch (error) {
    console.error("Error fetching metadata:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
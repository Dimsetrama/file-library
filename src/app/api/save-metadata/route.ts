// src/app/api/drive/save-metadata/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { google } from "googleapis";
import { Readable } from 'stream';

const METADATA_FILE_NAME = 'index_metadata.json';

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !session.accessToken) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const body = await request.json();
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: session.accessToken });
    const drive = google.drive({ version: "v3", auth });

    // Check if metadata file already exists
    const searchRes = await drive.files.list({
      q: `name='${METADATA_FILE_NAME}' and trashed = false`,
      fields: 'files(id)',
    });

    const fileId = searchRes.data.files?.[0]?.id;
    const metadataContent = JSON.stringify(body);
    const media = {
      mimeType: 'application/json',
      body: Readable.from([metadataContent]),
    };

    if (fileId) {
      // Update existing file
      await drive.files.update({ fileId, media });
    } else {
      // Create new file
      await drive.files.create({
        requestBody: { name: METADATA_FILE_NAME, mimeType: 'application/json' },
        media: media,
      });
    }

    return NextResponse.json({ message: "Metadata saved successfully." });

  } catch (error) {
    console.error("Error saving metadata:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
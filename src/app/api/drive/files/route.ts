// src/app/api/drive/files/route.ts

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]/route";
import { google } from "googleapis";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session || !session.accessToken) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: session.accessToken });

    const drive = google.drive({ version: "v3", auth });

    // FIX: The search query has been condensed into a single line
    // to avoid issues with whitespace and newlines.
    const searchQuery = `(mimeType='application/pdf' or mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document' or mimeType='application/vnd.openxmlformats-officedocument.presentationml.presentation') and trashed = false`;

    const res = await drive.files.list({
      pageSize: 20,
      fields: "nextPageToken, files(id, name, mimeType)",
      orderBy: "modifiedTime desc",
      q: searchQuery,
    });

    const files = res.data.files;
    return NextResponse.json({ files });
  } catch (error) {
    console.error("Error fetching Google Drive files", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
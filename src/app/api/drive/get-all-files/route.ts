// src/app/api/drive/get-all-files/route.ts

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { google, drive_v3 } from "googleapis";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !session.accessToken) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: session.accessToken });
    const drive = google.drive({ version: "v3", auth });

    const searchQuery = `(mimeType='application/pdf' or mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document' or mimeType='application/vnd.openxmlformats-officedocument.presentationml.presentation') and trashed = false`;

    let allFiles: drive_v3.Schema$File[] = [];
    let pageToken: string | undefined = undefined;

    do {
      // THIS IS THE FIX: We explicitly type 'res' as 'any'
      // and disable the ESLint rule that complains about it.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await drive.files.list({
        pageSize: 100,
        fields: "nextPageToken, files(id, name, mimeType)",
        q: searchQuery,
        pageToken: pageToken,
      });

      if (res.data.files) {
        allFiles = allFiles.concat(res.data.files);
      }
      pageToken = res.data.nextPageToken || undefined;
    } while (pageToken);

    return NextResponse.json({ files: allFiles });

  } catch (error) {
    console.error("Error fetching all Google Drive files:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
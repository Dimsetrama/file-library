// src/lib/drive.ts
import { google, drive_v3 } from 'googleapis';

export const SUPPORTED_MIMETYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
];

export const DRIVE_SEARCH_QUERY = `(mimeType='${SUPPORTED_MIMETYPES.join("' or mimeType='")}') and trashed = false`;

export const INDEX_FILE_NAME = 'search_index.json';

export async function getDriveClient(accessToken: string): Promise<drive_v3.Drive> {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.drive({ version: "v3", auth });
}

export async function getIndexFile(drive: drive_v3.Drive): Promise<drive_v3.Schema$File | undefined> {
  const searchRes = await drive.files.list({
    q: `name='${INDEX_FILE_NAME}' and trashed = false`,
    fields: 'files(id, description)',
  });
  return searchRes.data.files?.[0];
}
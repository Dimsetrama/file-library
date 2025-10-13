import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';

const STATUS_FILE_PATH = path.join(process.cwd(), '.tmp', 'indexing-status.json');

export async function GET() {
    try {
        // Check if the file exists before trying to read it
        await fs.access(STATUS_FILE_PATH); 
        const data = await fs.readFile(STATUS_FILE_PATH, 'utf-8');
        const status = JSON.parse(data);
        return NextResponse.json(status);
    } catch (error) {
        // If the file doesn't exist, it's safe to assume the process is idle or just starting.
        // This prevents the server from crashing and sends a clean response to the browser.
        return NextResponse.json({ status: 'idle', message: 'Waiting for process to start...' });
    }
}


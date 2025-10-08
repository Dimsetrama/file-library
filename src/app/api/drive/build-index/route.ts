// src/app/api/drive/build-index/route.ts

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { spawn } from 'child_process'; // Node.js tool for running scripts

export async function POST() {
    const session = await getServerSession(authOptions);
    if (!session || !session.accessToken) {
        return new NextResponse(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
    }

    // Get the path to our script
    const scriptPath = 'scripts/build-index.js';

    // Run the script in the background using Node.js
    // We pass the accessToken as a command-line argument
    const child = spawn('node', [scriptPath, session.accessToken], {
        detached: true, // Allows the script to run even after the request is finished
        stdio: 'ignore' // Prevents the parent process from waiting
    });

    // Unreference the child process to allow the parent (this API route) to exit
    child.unref();

    // Immediately tell the browser that the process has started
    return new NextResponse(JSON.stringify({ message: "Indexing process started in the background." }), { status: 202 });
}

export const maxDuration = 300; // Keep this for Vercel
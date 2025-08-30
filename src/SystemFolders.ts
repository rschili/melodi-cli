import os from "os";
import path from "path";
import fs from "fs";

const MELODI_CONFIG_ENV = "MELODI_CONFIG";
const MELODI_CACHE_ENV = "MELODI_CACHE";
const MELODI_ROOT_ENV = "MELODI_ROOT";

const appName = 'melodi';


export function getConfigDir(): string {
    if (process.env[MELODI_CONFIG_ENV]) {
        return process.env[MELODI_CONFIG_ENV];
    }
    
    const home = os.homedir();
    switch (process.platform) {
        case "win32":
            return path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), appName, "config");
        case "darwin":
        case "linux":
        default:
            return path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), appName);
    }
}

export function getCacheDir(): string {
    if (process.env[MELODI_CACHE_ENV]) {
        return process.env[MELODI_CACHE_ENV];
    }
    
    const home = os.homedir();
    switch (process.platform) {
        case "win32":
            return path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), appName, "cache");
        case "darwin":
            return path.join(process.env.XDG_CACHE_HOME || path.join(home, "Library", "Caches"), appName);
        case "linux":
        default:
            return path.join(process.env.XDG_CACHE_HOME || path.join(home, ".cache"), appName);
    }
}

export function getDocumentsDir(): string {
    if (process.env[MELODI_ROOT_ENV]) {
        return process.env[MELODI_ROOT_ENV];
    }
    
    const home = os.homedir();

    if (process.platform === "win32") {
        // Windows Known Folders: usually %USERPROFILE%\Documents
        const docs = path.join(process.env.USERPROFILE || home, "Documents");
        return appName ? path.join(docs, appName) : docs;
    }

    if (process.platform === "darwin") {
        // macOS: ~/Documents
        const docs = path.join(home, "Documents");
        return appName ? path.join(docs, appName) : docs;
    }

    if (process.platform === "linux") {
        // Linux: use XDG user-dirs if available, fallback to ~/Documents
        const userDirsFile = path.join(home, ".config", "user-dirs.dirs");
        let docs: string | null = null;

        if (fs.existsSync(userDirsFile)) {
            const content = fs.readFileSync(userDirsFile, "utf8");
            const match = content.match(/XDG_DOCUMENTS_DIR="?([^"\n]+)"?/);
            if (match) {
                docs = match[1].replace("$HOME", home);
            }
        }

        if (!docs) {
            docs = path.join(home, "Documents");
        }

        return appName ? path.join(docs, appName) : docs;
    }

    // fallback
    return appName ? path.join(home, appName) : home;
}

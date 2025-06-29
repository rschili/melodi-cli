import z from "zod/v4";
import fs from 'fs/promises';
import axios, { AxiosRequestConfig } from 'axios';
import path from "path";

export const GithubBisSchemasRootUrl = "https://raw.githubusercontent.com/iTwin/bis-schemas/refs/heads/master/";
export const SchemaInventoryPath = "SchemaInventory.json";
export const ETagCacheFileName = "etag.json";

const SchemaInventorySchema = z.record(z.string(), z.array(
    z.object({
        name: z.string(),
        path: z.string().optional(),
        released: z.boolean(),
        version: z.string(),
    })
));

export type SchemaInventory = z.infer<typeof SchemaInventorySchema>;

const ETagCacheSchema = z.record(z.string(), z.string());

export type ETagCache = z.infer<typeof ETagCacheSchema>;

export async function loadSchemaInventory(cacheDirectory: string): Promise<SchemaInventory> {
    const etagCacheFilePath = `${cacheDirectory}/${ETagCacheFileName}`;
    let etagCache: ETagCache = {};
    if(await fileExists(etagCacheFilePath)) {
        const fileContents = await fs.readFile(etagCacheFilePath, 'utf-8');
        etagCache = ETagCacheSchema.parse(JSON.parse(fileContents));
    }

    const schemaInventory = await fetchUrl(GithubBisSchemasRootUrl, SchemaInventoryPath, cacheDirectory, etagCache);
    await fs.writeFile(etagCacheFilePath, JSON.stringify(etagCache, null, 2), 'utf-8');
    const parsedInventory = SchemaInventorySchema.parse(JSON.parse(schemaInventory));
    return parsedInventory;
}

// Fetch from cache or download if not cached
async function fetchUrl(rootUrl: string, subUrl: string, cacheDirectory: string, etagCache: ETagCache): Promise<string> {
    const url = new URL(subUrl, rootUrl);
    const cacheFilePath = path.join(cacheDirectory, subUrl.replace(/\//g, '_'));
    const etag = etagCache[url.href];
    let options: AxiosRequestConfig<any> = { responseType: 'text', validateStatus: (status) => status === 200 || status === 304 };
    if(etag && await fileExists(cacheFilePath)) {
        options.headers = { 'If-None-Match': etag };
    }

    const response = await axios.get(url.href, options);
    if (response.status === 304) {
        // Not modified, return cached content
        const cachedContent = await fs.readFile(cacheFilePath, 'utf-8');
        return cachedContent;
    }

    etagCache[url.href] = response.headers.etag;
    await fs.writeFile(cacheFilePath, response.data, 'utf-8');
    return response.data;
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        const stats = await fs.stat(filePath);
        return stats.isFile();
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            return false; // File does not exist
        }
        throw error; // Rethrow other errors
    }
}
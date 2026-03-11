import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { log } from "@clack/prompts";
import chalk from "chalk";
import { z } from "zod/v4";
import { QueryOptionsBuilder, QueryRowFormat } from "@itwin/core-common";
import { UnifiedDb } from "../UnifiedDb";
import { WorkspaceFile } from "../Context";

export class McpServerHost {
    public static async run(file: WorkspaceFile, db: UnifiedDb): Promise<void> {
        const mcp = new McpServer({
            name: "melodi",
            version: "1.0.0",
        });

        this.registerTools(mcp, db);

        // Track active transport so POST messages can be routed to it
        let activeTransport: SSEServerTransport | undefined;

        const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
            const url = new URL(req.url ?? "", `http://${req.headers.host}`);
            const pathname = url.pathname;

            log.info(`${chalk.dim(new Date().toLocaleTimeString())} ${chalk.cyan(req.method)} ${pathname}`);

            try {
                if (pathname === "/sse" && req.method === "GET") {
                    // SSE connection: create transport, connect, and start streaming
                    const transport = new SSEServerTransport("/messages", res);
                    activeTransport = transport;
                    await mcp.connect(transport);
                } else if (pathname === "/messages" && req.method === "POST") {
                    if (!activeTransport) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ error: "No active SSE connection" }));
                        return;
                    }
                    await activeTransport.handlePostMessage(req, res);
                } else {
                    res.writeHead(404);
                    res.end("Not found");
                }
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                log.error(`Request failed: ${message}`);
                if (!res.headersSent) {
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Internal server error" }));
                }
            }
        });

        const port = await new Promise<number>((resolve, reject) => {
            httpServer.listen(0, "127.0.0.1", () => {
                const addr = httpServer.address();
                if (addr && typeof addr === "object") {
                    resolve(addr.port);
                } else {
                    reject(new Error("Failed to get server address"));
                }
            });
            httpServer.on("error", reject);
        });

        const url = `http://127.0.0.1:${port}/sse`;
        console.log();
        log.success(`MCP server started for ${chalk.bold(file.relativePath)}`);
        log.info(`URL: ${chalk.cyan(url)}`);
        log.message(chalk.dim("Add this to your AI client's MCP configuration:"));
        console.log(chalk.dim(JSON.stringify({ type: "sse", url }, null, 2)));
        console.log();
        log.message(`Press ${chalk.bold("Ctrl+C")} to stop the server and return to the menu.`);

        // Wait for Ctrl+C
        await new Promise<void>((resolve) => {
            const handler = () => {
                process.off("SIGINT", handler);
                resolve();
            };
            process.on("SIGINT", handler);
        });

        httpServer.close();
        console.log();
        log.info("MCP server stopped.");
    }

    private static registerTools(mcp: McpServer, db: UnifiedDb): void {
        mcp.registerTool(
            "get_imodel_query_guide",
            {
                description: "Returns comprehensive instructions on how to write ECSql queries for the connected iModel, plus a compact representation of the available schemas, classes, and properties. Call this first before writing any queries.",
            },
            async () => {
                log.info(`${chalk.dim(new Date().toLocaleTimeString())} Tool: ${chalk.cyan("get_imodel_query_guide")}`);
                // TODO: Return a comprehensive ECSql guide with syntax, examples, and common patterns
                return {
                    content: [{ type: "text" as const, text: "ECSql guide placeholder. For now, you may run 'select * from bis.Element LIMIT 5'." }],
                };
            }
        );

        mcp.registerTool(
            "query_imodel",
            {
                description: "Execute an ECSql query against the open iModel and return results as JSON. Results are limited to 100 rows.",
                inputSchema: { query: z.string().describe("The ECSql query to execute") },
            },
            async ({ query }) => {
                log.info(`${chalk.dim(new Date().toLocaleTimeString())} Tool: ${chalk.cyan("query_imodel")} ${chalk.dim(query)}`);
                try {
                    const queryOptions = new QueryOptionsBuilder();
                    queryOptions.setRowFormat(QueryRowFormat.UseECSqlPropertyIndexes);
                    queryOptions.setLimit({ count: 101 });
                    queryOptions.setAbbreviateBlobs(true);

                    const reader = db.createQueryReader(query, undefined, queryOptions.getOptions());
                    const rows = await reader.toArray();
                    const metadata = await reader.getMetaData();

                    if (rows.length === 0) {
                        log.info(`${chalk.dim(new Date().toLocaleTimeString())} Query returned ${chalk.yellow("0")} rows.`);
                        return { content: [{ type: "text" as const, text: "No rows returned." }] };
                    }

                    const truncated = rows.length > 100;
                    const resultRows = truncated ? rows.slice(0, 100) : rows;
                    log.info(`${chalk.dim(new Date().toLocaleTimeString())} Query returned ${chalk.yellow(String(resultRows.length))} rows${truncated ? " (truncated)" : ""}.`);

                    // Build JSON objects using indexes from metadata (matches DbEditor pattern)
                    const jsonRows = resultRows.map(row => {
                        const obj: Record<string, unknown> = {};
                        const rowArray = row as unknown[];
                        for (let i = 0; i < metadata.length; i++) {
                            obj[metadata[i].name] = rowArray[i] ?? null;
                        }
                        return obj;
                    });

                    const result = {
                        columns: metadata.map(col => ({ name: col.name, type: col.extendedType ?? col.typeName })),
                        rows: jsonRows,
                        rowCount: jsonRows.length,
                        truncated,
                    };

                    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
                } catch (err: unknown) {
                    const message = err instanceof Error ? err.message : String(err);
                    log.warn(`Query failed: ${message}`);
                    return { content: [{ type: "text" as const, text: `Query failed: ${message}` }], isError: true };
                }
            }
        );
    }
}

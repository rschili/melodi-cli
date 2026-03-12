import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { log, text, isCancel } from "@clack/prompts";
import chalk from "chalk";
import { z } from "zod/v4";
import { UnifiedDb } from "../UnifiedDb";
import { WorkspaceFile } from "../Context";
import { executeAndPrintQuery } from "./QueryRunner";
import ecsqlGuide from "./ecsql-guide.md";

export class McpServerHost {
    private static queryInProgress = false;

    private static readonly DEFAULT_PORT = 30591; // "3C5Q1", ECSql in leet

    public static async run(file: WorkspaceFile, db: UnifiedDb): Promise<void> {
        const portInput = await text({
            message: "Port for MCP server",
            initialValue: String(this.DEFAULT_PORT),
            validate: (value) => {
                const n = Number(value);
                if (!Number.isInteger(n) || n < 1 || n > 65535) return "Enter a valid port (1-65535)";
            },
        });
        if (isCancel(portInput)) return;
        const chosenPort = Number(portInput);

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
            httpServer.listen(chosenPort, "127.0.0.1", () => {
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
                description: "Returns instructions on how to write ECSql queries for iModels, including available standard schemas, classes, and syntax notes. Call this first before writing any queries.",
            },
            async () => {
                log.info(`${chalk.dim(new Date().toLocaleTimeString())} Tool: ${chalk.cyan("get_imodel_query_guide")}`);
                return {
                    content: [{ type: "text" as const, text: ecsqlGuide }],
                };
            }
        );

        mcp.registerTool(
            "query_imodel",
            {
                description: "Execute an ECSql query against the open iModel. Results are printed to the user's console as a formatted table. Returns a summary with row count and execution time. Only one query can run at a time.",
                inputSchema: { query: z.string().describe("The ECSql query to execute") },
            },
            async ({ query }) => {
                log.info(`${chalk.dim(new Date().toLocaleTimeString())} Tool: ${chalk.cyan("query_imodel")} ${chalk.dim(query)}`);

                if (this.queryInProgress) {
                    return {
                        content: [{ type: "text" as const, text: "A query is already in progress. Please wait for it to complete before running another." }],
                        isError: true,
                    };
                }

                this.queryInProgress = true;
                try {
                    const result = await executeAndPrintQuery(db, query);
                    const durationStr = result.durationMs < 1000
                        ? `${result.durationMs.toFixed()} ms`
                        : `${(result.durationMs / 1000).toFixed(2)} s`;
                    const summary = `Query completed: ${result.rowCount} row${result.rowCount !== 1 ? "s" : ""} printed to console in ${durationStr}.${result.truncated ? " Results were truncated to 100 rows." : ""}`;
                    return { content: [{ type: "text" as const, text: summary }] };
                } catch (err: unknown) {
                    const message = err instanceof Error ? err.message : String(err);
                    log.warn(`Query failed: ${message}`);
                    return { content: [{ type: "text" as const, text: `Query failed: ${message}` }], isError: true };
                } finally {
                    this.queryInProgress = false;
                }
            }
        );
    }
}

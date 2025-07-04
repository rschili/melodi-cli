import chalk from "chalk";

export class LogBuffer {
    private buffer: string[] = [];
    private originalLog: (...args: unknown[]) => void = console.log;

    /** Start collecting logs (overrides console.log) */
    start() {
        this.originalLog = console.log;
        console.log = (...args: unknown[]) => {
            this.buffer.push(args.join(' '));
        };
    }

    /** Restore the original console.log */
    restorePrintAndClear() {
        console.log = this.originalLog;
        if (this.buffer.length > 0) {
            console.log("Collected logs:");
            this.buffer.forEach(log => {
                log.split('\n').forEach(line => console.log(chalk.gray('\t' + line)));
            });
        }
        this.buffer = [];
    }
}
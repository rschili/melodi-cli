
export async function withTimeout<T>(task: Promise<T>, seconds: number): Promise<T> {
    let id: NodeJS.Timeout;
    const timer = new Promise<never>((_, reject) => {
        id = setTimeout(() => reject(new Error(`Timeout of ${seconds} seconds exceeded.`)), seconds * 1000);
    });

    try {
        return await Promise.race([task, timer]) as T;
    } finally {
        clearTimeout(id!);
    }
}
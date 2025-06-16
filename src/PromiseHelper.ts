
export function withTimeout<T>(task: () => Promise<T>, seconds: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error(`Task timed out after ${seconds} seconds`));
        }, seconds * 1000);

        task()
            .then(result => {
                clearTimeout(timeout);
                resolve(result);
            })
            .catch(err => {
                clearTimeout(timeout);
                reject(err);
            });
    });
}
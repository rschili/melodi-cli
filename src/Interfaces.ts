export interface NamedTask<T> {
  name: string;
  execute: () => Promise<T>;
}


export enum Environment {
    PROD = 'PROD',
    QA = 'QA',
    DEV = 'DEV',
}
import { __BUILD_DATE__ } from "./buildInfo";
import pkg from '../package.json'
import updateNotifier from 'simple-update-notifier'

export const applicationVersion: string = pkg.version;

export const applicationBuildDate: string = new Date(__BUILD_DATE__).toLocaleString();

export async function checkUpdates(): Promise<void> {
    await updateNotifier({ pkg: pkg });
}
import { __BUILD_DATE__ } from "./buildInfo";
import pkg from '../package.json';

export const applicationVersion: string = pkg.version;

export const applicationBuildDate: string = new Date(__BUILD_DATE__).toLocaleString();
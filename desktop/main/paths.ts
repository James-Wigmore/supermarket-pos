import { join } from 'node:path';

/** Folder holding `backend/`, `frontend/` and `desktop/`: the staged app, in development and when packaged. */
export const appRoot = () => join(__dirname, '../..');

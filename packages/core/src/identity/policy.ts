// Session policy constants — dependency-free so edge bundles (middleware,
// cookie config) can import them without pulling node:crypto or the DB stack.
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_UPDATE_AGE_MS = 24 * 60 * 60 * 1000;

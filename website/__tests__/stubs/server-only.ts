// Test stub for the `server-only` guard package. In app/build the real package
// throws if a server module is pulled into a client bundle; under vitest (node)
// we alias it to this no-op so the BFF route handlers and server libs can be
// imported and exercised directly.
export {};

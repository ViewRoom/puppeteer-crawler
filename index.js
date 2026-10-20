// Compatibility entry point. Production installations can use dist/cli/index.js.
import { tsImport } from "tsx/esm/api";

await tsImport("./src/cli/index.ts", import.meta.url);

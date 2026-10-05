import { checkInvariants, formatViolations } from "./invariants.ts";

const root = new URL("..", import.meta.url).pathname;
const violations = checkInvariants(root);
if (violations.length > 0) {
  console.error(formatViolations(violations));
  console.error(`\n${violations.length} invariant violation(s). Each message ends with the fix.`);
  process.exit(1);
}
console.log("invariants: ok");

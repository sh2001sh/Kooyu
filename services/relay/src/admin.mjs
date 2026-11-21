import { parseArgs } from "node:util";
import { statSync } from "node:fs";
import { RelayAdmission } from "./admission.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { db: { type: "string" } },
});
const [command, host] = positionals;
if (!values.db || !statSync(values.db).isFile() ||
    !["list", "revoke", "resume"].includes(command) ||
    (command !== "list" && !/^[a-f0-9]{64}$/.test(host ?? "")))
  throw Error("Usage: node src/admin.mjs --db /path/admission.sqlite list|revoke|resume [hostId]");
const admission = new RelayAdmission({ path: values.db });
try {
  if (command === "list") {
    console.log(JSON.stringify(admission.db.prepare(
      "SELECT id,host,created,blocked FROM anonymous_identities ORDER BY created DESC LIMIT 100",
    ).all(), null, 2));
  } else if (command === "revoke") {
    admission.revoke(host);
    console.log("Remote access revoked; local work is unaffected.");
  } else {
    admission.db.prepare("UPDATE anonymous_identities SET blocked=0 WHERE host=?").run(host);
    console.log("Remote access restored; reconnect to receive a new credential.");
  }
} finally { admission.close(); }

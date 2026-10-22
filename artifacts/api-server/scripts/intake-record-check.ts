/**
 * Runs the real intake router against development storage with an isolated user.
 * Authentication is injected only into this ephemeral, loopback-only test server.
 * No login bypass or test routes are added to the application.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { pool } from "@workspace/db";
import router from "../src/routes/intake";
import { blankModel, sourceHash } from "../src/lib/intake-model";

const userId = `intake-check-${randomUUID()}`;
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.isAuthenticated = () => true;
  req.user = { id: userId } as Express.User;
  req.log = { error() {}, warn() {} } as typeof req.log;
  next();
});
app.use(router);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const address = server.address();
assert(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}`;
async function request(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { "Content-Type": "application/json", Origin: base },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}
let briefId: string | undefined;
try {
  const created = await request("/intake/records", "POST", {});
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.title, "", "collection must not invent a title");
  const id = created.body.id;
  const model = blankModel();
  model.sources = [{ id: "problem", name: "Clinic needs", text: "Receptionists need to assign clinic appointments. Do not send patient messages.", files: [], changed: false, supplied: true }];
  model.profile = {
    problem: { value: "Receptionists need to assign clinic appointments.", reviewed: true, changed: false },
    user: { value: "Receptionists", reviewed: true, changed: false },
    scope: { value: "Appointment assignment; no patient messages.", reviewed: true, changed: false },
    outcome: { value: "Appointments are assigned.", reviewed: true, changed: false },
  };
  model.requirements = [
    { id: "assign", text: "Assign clinic appointments.", sources: ["problem"], reviewed: true, changed: false },
    { id: "no-messages", text: "Do not send patient messages.", sources: ["problem"], reviewed: true, changed: false },
  ];
  model.orderReviewed = true;
  model.agreed = true;
  model.interpretedHash = sourceHash(model);
  // Seed an already interpreted legacy model to test backward compatibility,
  // persistence and reviewed handoff independently of AI/network availability.
  await pool.query("UPDATE intake_records SET model=$1,title=$2,status='review' WHERE id=$3 AND user_id=$4",
    [JSON.stringify(model), "Clinic Appointment Assignment", id, userId]);
  const loaded = await request(`/intake/records/${id}`);
  assert.equal(loaded.status, 200);
  const renamed = await request(`/intake/records/${id}`, "PUT", {
    title: "Reception Appointment Desk", model: loaded.body.model, revision: loaded.body.revision,
  });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
  assert.equal(renamed.body.title, "Reception Appointment Desk");
  assert.equal(renamed.body.model.name.origin, "manual");
  const stale = await request(`/intake/records/${id}`, "PUT", {
    title: "Stale overwrite", model: loaded.body.model, revision: loaded.body.revision,
  });
  assert.equal(stale.status, 409, "stale save must not overwrite current review");
  const reopened = await request(`/intake/records/${id}`);
  assert.equal(reopened.body.title, "Reception Appointment Desk");
  assert.deepEqual(reopened.body.model.requirements.map((r: { text: string }) => r.text), model.requirements.map(r => r.text));
  const notConfirmed = await request(`/intake/records/${id}/compare`, "POST", { revision: renamed.body.revision });
  assert.equal(notConfirmed.status, 400);
  const confirmed = await request(`/intake/records/${id}/confirm`, "POST", { revision: renamed.body.revision });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  const staleConfirm = await request(`/intake/records/${id}/confirm`, "POST", { revision: renamed.body.revision });
  assert.equal(staleConfirm.status, 409);
  const compared = await request(`/intake/records/${id}/compare`, "POST", { revision: confirmed.body.revision });
  assert.equal(compared.status, 200, JSON.stringify(compared.body));
  briefId = compared.body.briefId;
  const { rows } = await pool.query("SELECT * FROM briefs WHERE id=$1", [briefId]);
  assert.deepEqual(rows[0].requirements.map((r: { text: string }) => r.text), model.requirements.map(r => r.text), "handoff uses reviewed wording and priority without interpretation");
  assert.match(JSON.stringify(rows[0]), /Reception Appointment Desk/, "manual name survives downstream handoff");
  const repeat = await request(`/intake/records/${id}/compare`, "POST", { revision: confirmed.body.revision });
  assert.equal(repeat.body.briefId, briefId, "handoff is idempotent");
  const staleSources = structuredClone(confirmed.body.model);
  staleSources.sources[0].text += " An additional unresolved scope change.";
  staleSources.sources[0].changed = false;
  await pool.query("UPDATE intake_records SET model=$1 WHERE id=$2 AND user_id=$3", [JSON.stringify(staleSources), id, userId]);
  const rejectedName = await request(`/intake/records/${id}/interpret`, "POST", { revision: confirmed.body.revision, regenerateName: true });
  assert.equal(rejectedName.status, 422);
  assert.match(rejectedName.body.error, /latest inputs/);
  const preserved = await request(`/intake/records/${id}`);
  assert.equal(preserved.body.revision, confirmed.body.revision);
  assert.equal(preserved.body.title, confirmed.body.title);
  assert.deepEqual(preserved.body.model.requirements, staleSources.requirements);
  console.log("Intake API checks passed: optional title, legacy read, manual rename, reopen, revision conflicts, confirmation, reviewed handoff.");
} finally {
  if (briefId) await pool.query("DELETE FROM briefs WHERE id=$1", [briefId]);
  await pool.query("DELETE FROM intake_records WHERE user_id=$1", [userId]);
  server.close();
  await pool.end();
}

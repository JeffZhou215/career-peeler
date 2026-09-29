import assert from "node:assert/strict";
import test from "node:test";
import { withdrawSubmittedRolesSequentially } from "../src/sidepanel/lib/submittedWithdrawals.mjs";

const roles = [
  { jobId: "100", title: "First role" },
  { jobId: "200", title: "Second role" }
];

test("a lost response is verified without replaying the first withdrawal", async () => {
  const sent = [];
  const confirmed = [];
  const result = await withdrawSubmittedRolesSequentially(roles, {
    withdrawOne: async (role) => {
      sent.push(role.jobId);
      if (role.jobId === "100") throw new Error("message channel closed");
      return { ok: true, data: { withdrawn: [{ jobId: role.jobId }] } };
    },
    verifyRoleStatus: async (role) => {
      assert.equal(role.jobId, "100");
      return { active: false, confirmationOpen: false };
    },
    onRoleConfirmed: ({ role }) => confirmed.push(role.jobId)
  });

  assert.deepEqual(sent, ["100", "200"]);
  assert.deepEqual(confirmed, ["100", "200"]);
  assert.equal(result[0].verifiedAfterInterruption, true);
  assert.equal(result[1].verifiedAfterInterruption, false);
});

test("an open Apple confirmation stops the queue before the next role", async () => {
  const sent = [];
  await assert.rejects(
    withdrawSubmittedRolesSequentially(roles, {
      withdrawOne: async (role) => {
        sent.push(role.jobId);
        throw new Error("message channel closed");
      },
      verifyRoleStatus: async () => ({ active: true, confirmationOpen: true })
    }),
    /confirmation is still open/
  );
  assert.deepEqual(sent, ["100"]);
});

test("an active role after a lost response is never retried automatically", async () => {
  const sent = [];
  await assert.rejects(
    withdrawSubmittedRolesSequentially(roles, {
      withdrawOne: async (role) => {
        sent.push(role.jobId);
        throw new Error("message channel closed");
      },
      verifyRoleStatus: async () => ({ active: true, confirmationOpen: false })
    }),
    /still active or its status is uncertain/
  );
  assert.deepEqual(sent, ["100"]);
});

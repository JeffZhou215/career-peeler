import assert from "node:assert/strict";
import test from "node:test";
import { withdrawSubmittedRolesSequentially } from "../src/sidepanel/lib/submittedWithdrawals.mjs";

const roles = [
  { jobId: "100", title: "First role" },
  { jobId: "200", title: "Second role" }
];
const operation = { batchId: "confirmed-batch", requestId: "withdrawal-request" };
const acknowledged = role => ({ ok: true, data: { ...operation, jobId: role.jobId, identityVerified: true,
  withdrawn: [{ jobId: role.jobId }], failed: [] } });
const confirmedStatus = role => ({ ...operation, jobId: role.jobId, identityVerified: true,
  withdrawalConfirmed: true, active: false, confirmationOpen: false });

test("a lost response is verified without replaying the first withdrawal", async () => {
  const sent = [];
  const confirmed = [];
  const result = await withdrawSubmittedRolesSequentially(roles, {
    ...operation,
    withdrawOne: async (role) => {
      sent.push(role.jobId);
      if (role.jobId === "100") throw new Error("message channel closed");
      return acknowledged(role);
    },
    verifyRoleStatus: async (role) => {
      assert.equal(role.jobId, "100");
      return confirmedStatus(role);
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
      ...operation,
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
      ...operation,
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

test("an explicit failed withdrawal is never promoted from absence in the inventory", async () => {
  for (const response of [
    { ok: false, error: "The reviewed role is no longer the current modal target." },
    { ok: true, data: { ...operation, withdrawn: [], failed: [{ jobId: "100", error: "Modal identity changed." }] } }
  ]) {
    const sent = [];
    let statusReads = 0;
    await assert.rejects(withdrawSubmittedRolesSequentially(roles, {
      ...operation,
      withdrawOne: async role => { sent.push(role.jobId); return response; },
      verifyRoleStatus: async role => { statusReads += 1; return confirmedStatus(role); }
    }), /withdrawal was not confirmed/);
    assert.deepEqual(sent, ["100"]);
    assert.equal(statusReads, 0);
  }
});

test("an explicit unknown outcome may reconcile only the same confirmed operation without replay", async () => {
  const sent = [];
  const result = await withdrawSubmittedRolesSequentially(roles, {
    ...operation,
    withdrawOne: async role => {
      sent.push(role.jobId);
      return role.jobId === "100" ? { ok: false, data: { ...operation, outcomeUnknown: true,
        failed: [{ jobId: role.jobId, error: "Confirmation response was interrupted." }] } } : acknowledged(role);
    },
    verifyRoleStatus: async role => confirmedStatus(role)
  });
  assert.deepEqual(sent, ["100", "200"]);
  assert.equal(result[0].verifiedAfterInterruption, true);
});

test("absence alone, stale operation proofs, and changed full job IDs cannot acknowledge a lost reply", async () => {
  for (const change of [
    { withdrawalConfirmed: false }, { identityVerified: false }, { batchId: "old-batch" },
    { requestId: "old-request" }, { jobId: "100-other-location" }, { active: null }
  ]) {
    const sent = [];
    await assert.rejects(withdrawSubmittedRolesSequentially(roles, {
      ...operation,
      withdrawOne: async role => { sent.push(role.jobId); throw new Error("message channel closed"); },
      verifyRoleStatus: async role => ({ ...confirmedStatus(role), ...change })
    }), /status is uncertain/);
    assert.deepEqual(sent, ["100"]);
  }
});

test("stale or unbound success responses stop without reconciling or removing another role", async () => {
  for (const response of [
    { ok: true, data: { ...acknowledged(roles[0]).data, batchId: "other-batch" } },
    { ok: true, data: { ...acknowledged(roles[0]).data, requestId: "other-request" } },
    { ok: true, data: { ...acknowledged(roles[0]).data, identityVerified: false } },
    { ok: true, data: { ...acknowledged(roles[0]).data, jobId: "200" } },
    acknowledged({ jobId: "100-other-location" }),
    { ok: true, data: { ...operation, identityVerified: true, withdrawn: roles, failed: [] } }
  ]) {
    let statusReads = 0, confirmations = 0;
    await assert.rejects(withdrawSubmittedRolesSequentially(roles, {
      ...operation,
      withdrawOne: async () => response,
      verifyRoleStatus: async role => { statusReads += 1; return confirmedStatus(role); },
      onRoleConfirmed: () => { confirmations += 1; }
    }), /withdrawal was not confirmed/);
    assert.equal(statusReads, 0);
    assert.equal(confirmations, 0);
  }
});

test("a later failure preserves earlier confirmed results and never processes the remaining role", async () => {
  const sent = [], saved = [];
  await assert.rejects(withdrawSubmittedRolesSequentially([...roles, { jobId: "300", title: "Third role" }], {
    ...operation,
    withdrawOne: async role => {
      sent.push(role.jobId);
      return role.jobId === "100" ? acknowledged(role) : { ok: false, error: "Apple refused the next withdrawal." };
    },
    verifyRoleStatus: async () => { throw new Error("Known failures must not be reconciled."); },
    onRoleConfirmed: ({ role }) => saved.push(role.jobId)
  }), error => {
    assert.match(error.message, /Apple refused/);
    assert.deepEqual(error.confirmed.map(result => result.role.jobId), ["100"]);
    return true;
  });
  assert.deepEqual(sent, ["100", "200"]);
  assert.deepEqual(saved, ["100"]);
});

test("a persistence failure after confirmed withdrawal retains that success and stops before another mutation", async () => {
  const sent = [];
  await assert.rejects(withdrawSubmittedRolesSequentially(roles, {
    ...operation,
    withdrawOne: async role => { sent.push(role.jobId); return acknowledged(role); },
    onRoleConfirmed: () => { throw new Error("Local cache write failed."); }
  }), error => {
    assert.match(error.message, /cache write failed/);
    assert.deepEqual(error.confirmed.map(result => result.role.jobId), ["100"]);
    return true;
  });
  assert.deepEqual(sent, ["100"]);
});

test("a failed status read after transport loss preserves previous confirmed roles and never retries", async () => {
  const sent = [];
  await assert.rejects(withdrawSubmittedRolesSequentially(roles, {
    ...operation,
    withdrawOne: async role => {
      sent.push(role.jobId);
      if (role.jobId === "200") throw new Error("message channel closed");
      return acknowledged(role);
    },
    verifyRoleStatus: async () => { throw new Error("Apple account is not authenticated."); }
  }), error => {
    assert.match(error.message, /could not be verified.*not authenticated/);
    assert.deepEqual(error.confirmed.map(result => result.role.jobId), ["100"]);
    return true;
  });
  assert.deepEqual(sent, ["100", "200"]);
});

test("a withdrawal cannot start without a confirmed operation identity", async () => {
  let mutations = 0;
  await assert.rejects(withdrawSubmittedRolesSequentially(roles, {
    withdrawOne: async () => { mutations += 1; return acknowledged(roles[0]); }
  }), /confirmed withdrawal batch and request/);
  assert.equal(mutations, 0);
});

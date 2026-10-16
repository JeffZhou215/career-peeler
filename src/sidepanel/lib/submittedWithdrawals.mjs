export async function withdrawSubmittedRolesSequentially(roles, {
  batchId,
  requestId,
  withdrawOne,
  verifyRoleStatus,
  onRoleStart = () => {},
  onRoleConfirmed = () => {}
}) {
  const confirmed = [];
  const matchesOperation = (data) => data?.batchId === batchId && data?.requestId === requestId;

  if (!batchId || !requestId) throw new Error("A confirmed withdrawal batch and request are required.");

  try {
    for (let index = 0; index < roles.length; index += 1) {
      const role = roles[index];
      await onRoleStart(role, index, roles.length);

      let response = null;
      let sendError = null;
      try {
        response = await withdrawOne(role);
      } catch (error) {
        sendError = error;
      }

      const acknowledged = response?.ok && matchesOperation(response.data) && response.data.identityVerified === true && response.data.inventoryVerified === true &&
        response.data.proofVersion === 2 && response.data.outcome === "inactive" &&
        String(response.data.jobId) === String(role.jobId) &&
        response.data.withdrawn?.length === 1 && !response.data.failed?.length &&
        String(response.data.withdrawn[0].jobId) === String(role.jobId);
      let verifiedAfterInterruption = false;

      if (!acknowledged) {
        const failure = response?.data?.failed?.[0]?.error || response?.error || sendError?.message ||
          "Apple did not acknowledge this withdrawal.";
        const outcomeUnknown = !response || (matchesOperation(response.data) && response.data.outcomeUnknown === true);
        if (!outcomeUnknown) {
          throw new Error(`${role.title || role.jobId}: ${failure} The withdrawal was not confirmed; the batch stopped.`);
        }
        let status;
        try {
          status = await verifyRoleStatus(role);
        } catch (verifyError) {
          throw new Error(`${role.title || role.jobId}: ${failure} Current submission status could not be verified: ${verifyError?.message || verifyError}`);
        }
        if (status?.confirmationOpen) {
          throw new Error(`${role.title || role.jobId}: Apple's confirmation is still open. Resolve it in Apple Careers before retrying.`);
        }
        if (!matchesOperation(status) || String(status?.jobId) !== String(role.jobId) ||
          status?.identityVerified !== true || status?.inventoryVerified !== true || status?.proofVersion !== 2 ||
          status?.outcome !== "inactive" || status?.withdrawalConfirmed !== true || status?.active !== false) {
          throw new Error(`${role.title || role.jobId}: ${failure} The role is still active or its status is uncertain; the batch stopped.`);
        }
        verifiedAfterInterruption = true;
      }

      const result = { role, verifiedAfterInterruption };
      confirmed.push(result);
      await onRoleConfirmed(result, index, roles.length);
    }
  } catch (failure) {
    const error = failure instanceof Error ? failure : new Error(String(failure));
    error.confirmed = [...confirmed];
    throw error;
  }

  return confirmed;
}

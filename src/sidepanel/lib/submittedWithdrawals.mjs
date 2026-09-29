export async function withdrawSubmittedRolesSequentially(roles, {
  withdrawOne,
  verifyRoleStatus,
  onRoleStart = () => {},
  onRoleConfirmed = () => {}
}) {
  const confirmed = [];

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

    const acknowledged = response?.ok && response.data?.withdrawn?.some(
      (entry) => String(entry.jobId) === String(role.jobId)
    );
    let verifiedAfterInterruption = false;

    if (!acknowledged) {
      const failure = response?.data?.failed?.[0]?.error || response?.error || sendError?.message ||
        "Apple did not acknowledge this withdrawal.";
      let status;
      try {
        status = await verifyRoleStatus(role);
      } catch (verifyError) {
        throw new Error(`${role.title || role.jobId}: ${failure} Current submission status could not be verified: ${verifyError?.message || verifyError}`);
      }
      if (status?.confirmationOpen) {
        throw new Error(`${role.title || role.jobId}: Apple's confirmation is still open. Resolve it in Apple Careers before retrying.`);
      }
      if (status?.active !== false) {
        throw new Error(`${role.title || role.jobId}: ${failure} The role is still active or its status is uncertain; the batch stopped.`);
      }
      verifiedAfterInterruption = true;
    }

    const result = { role, verifiedAfterInterruption };
    confirmed.push(result);
    await onRoleConfirmed(result, index, roles.length);
  }

  return confirmed;
}

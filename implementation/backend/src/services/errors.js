/**
 * Turns an ethers/contract error into a short, readable message. A reverted
 * contract call carries the contract's own reason string (e.g.
 * "ConsentManager: grantee is not a registered provider"); show just that
 * instead of the full transaction dump.
 */
function friendlyError(err) {
  if (!err) return "Unknown error";
  if (err.reason) return err.reason;
  if (err.revert && err.revert.args && err.revert.args[0]) return String(err.revert.args[0]);
  if (err.shortMessage) return err.shortMessage;
  return err.message || String(err);
}

module.exports = { friendlyError };

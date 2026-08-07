/**
 * Resolve write-env's target without ever combining an explicit environment
 * with canister/network values left behind by an unrelated sync step.
 */
export function frontendTarget(argv = [], env = process.env) {
  const explicitEnvironment = argv[0];
  const environment = explicitEnvironment ?? env.ICP_CLI_ENVIRONMENT ?? "local";
  if (environment !== "local" && environment !== "ic") {
    throw new Error(`unsupported environment "${environment}"; expected local or ic`);
  }
  return {
    environment,
    network: explicitEnvironment ?? env.ICP_CLI_NETWORK ?? environment,
    inheritSyncCanisterIds: explicitEnvironment === undefined,
  };
}

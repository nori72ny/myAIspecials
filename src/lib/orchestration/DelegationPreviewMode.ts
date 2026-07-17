export function shouldUseDelegationV2Preview(search: string): boolean {
  return new URLSearchParams(search).get("delegationV2") === "1";
}

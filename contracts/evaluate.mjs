/** Pure, fail-closed evaluator for the portable synthetic workflow contract. */
export function evaluateAction(contract, actionId, context) {
  const action = contract.actions.find((entry) => entry.id === actionId);
  if (!action) throw new Error(`Unknown action: ${actionId}`);
  const missing = [];
  if (context.actor !== action.actor) missing.push('actor');
  for (const key of action.scopeKey) {
    if (typeof context.scope?.[key] !== 'string' || !context.scope[key].trim()) missing.push(key);
  }
  for (const fact of action.requires) {
    if (context.facts?.[fact] !== true) missing.push(fact);
  }
  for (const fact of action.forbids || []) {
    if (context.facts?.[fact] !== false) missing.push(`not:${fact}`);
  }
  for (const [key, value] of Object.entries(action.equals || {})) {
    if (context.values?.[key] !== value) missing.push(`${key}=${value}`);
  }
  return { allowed: missing.length === 0, missing, result: null };
}

/** Return the committed outcome only after all readback facts are verified. */
export function finalizeAction(contract, actionId, context) {
  const preflight = evaluateAction(contract, actionId, context);
  const action = contract.actions.find((entry) => entry.id === actionId);
  const missing = [...preflight.missing];
  for (const fact of action.postconditions || []) {
    if (context.facts?.[fact] !== true) missing.push(fact);
  }
  return { allowed: missing.length === 0, missing, result: missing.length ? null : action.result };
}

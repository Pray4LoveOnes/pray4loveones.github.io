const encoder = new TextEncoder();
const RECORD_SCHEMA = 'agentchain-signed-record/1';
const BUNDLE_SCHEMA = 'agentchain-proof-bundle/1';
const ANCHOR_SCHEMA = 'agentchain-trust-anchors/1';
const EVALUATOR = 'agentchain-public-weighted-coverage/1';

export const schemas = Object.freeze({ bundle: BUNDLE_SCHEMA, record: RECORD_SCHEMA, trustAnchors: ANCHOR_SCHEMA });
export const algorithms = Object.freeze({ signature: 'Ed25519', digest: 'SHA-256' });
export const evaluationRule = EVALUATOR;

class ProofIssue extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function issue(status, code, message) {
  throw new ProofIssue(status, code, message);
}

function hasLoneSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function canonicalValue(value, path = '$') {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (hasLoneSurrogate(value)) issue('Invalid', 'invalid-unicode', `${path} contains an unpaired Unicode surrogate.`);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) issue('Invalid', 'noncanonical-number', `${path} must use a safe integer.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => canonicalValue(entry, `${path}[${index}]`));
  if (typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    const output = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      if (hasLoneSurrogate(key)) issue('Invalid', 'invalid-unicode', `${path} has an invalid object key.`);
      output[key] = canonicalValue(value[key], `${path}.${key}`);
    }
    return output;
  }
  issue('Invalid', 'non-json-value', `${path} is not a supported JSON value.`);
}

/** AgentChain Canonical JSON v1: sorted object keys, ordered arrays, UTF-8 strings, and safe integers only. */
export function canonicalize(value) {
  return JSON.stringify(canonicalValue(value));
}

function readStrictJson(text) {
  let cursor = 0;
  const whitespace = () => { while (cursor < text.length && /[ \t\n\r]/.test(text[cursor])) cursor += 1; };
  const fail = () => issue('Invalid', 'invalid-json', `Malformed JSON at character ${cursor}.`);
  const parseString = () => {
    const start = cursor;
    if (text[cursor] !== '"') fail();
    cursor += 1;
    while (cursor < text.length) {
      const char = text[cursor];
      if (char === '"') {
        cursor += 1;
        try { return JSON.parse(text.slice(start, cursor)); } catch { fail(); }
      }
      if (char === '\\') cursor += 1;
      cursor += 1;
    }
    fail();
  };
  const parseValue = () => {
    whitespace();
    const char = text[cursor];
    if (char === '"') return parseString();
    if (char === '{') {
      cursor += 1;
      const result = Object.create(null);
      const seen = new Set();
      whitespace();
      if (text[cursor] === '}') { cursor += 1; return result; }
      while (cursor < text.length) {
        whitespace();
        const key = parseString();
        if (seen.has(key)) issue('Invalid', 'duplicate-json-key', `Duplicate JSON property ${JSON.stringify(key)}.`);
        seen.add(key);
        whitespace();
        if (text[cursor] !== ':') fail();
        cursor += 1;
        result[key] = parseValue();
        whitespace();
        if (text[cursor] === '}') { cursor += 1; return result; }
        if (text[cursor] !== ',') fail();
        cursor += 1;
      }
      fail();
    }
    if (char === '[') {
      cursor += 1;
      const result = [];
      whitespace();
      if (text[cursor] === ']') { cursor += 1; return result; }
      while (cursor < text.length) {
        result.push(parseValue());
        whitespace();
        if (text[cursor] === ']') { cursor += 1; return result; }
        if (text[cursor] !== ',') fail();
        cursor += 1;
      }
      fail();
    }
    for (const [literal, value] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(literal, cursor)) { cursor += literal.length; return value; }
    }
    const number = text.slice(cursor).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (number) { cursor += number[0].length; return JSON.parse(number[0]); }
    fail();
  };
  const parsed = parseValue();
  whitespace();
  if (cursor !== text.length) fail();
  return parsed;
}

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return encoder.encode(String(value));
}

export function encodeBase64Url(bytes) {
  let binary = '';
  for (const byte of asBytes(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export function decodeBase64Url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/u.test(value) || value.length % 4 === 1) {
    issue('Invalid', 'invalid-base64url', 'A proof contains invalid base64url data.');
  }
  try {
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    if (encodeBase64Url(bytes) !== value) issue('Invalid', 'noncanonical-base64url', 'A proof contains noncanonical base64url data.');
    return bytes;
  } catch (error) {
    if (error instanceof ProofIssue) throw error;
    issue('Invalid', 'invalid-base64url', 'A proof contains invalid base64url data.');
  }
}

export function signedRecordBytes(kind, payload) {
  if (typeof kind !== 'string' || !kind) issue('Invalid', 'invalid-record-kind', 'Signed record kind is required.');
  return encoder.encode(canonicalize({ domain: 'AgentChain Public Proof Record', schema: RECORD_SCHEMA, kind, payload }));
}

export async function sha256Hex(value, cryptoProvider = globalThis.crypto) {
  if (!cryptoProvider?.subtle) issue('Unsupported', 'webcrypto-unavailable', 'This browser does not provide Web Crypto in a secure context.');
  const bytes = value instanceof Uint8Array || value instanceof ArrayBuffer ? asBytes(value) : encoder.encode(canonicalize(value));
  const digest = new Uint8Array(await cryptoProvider.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function keyIdFor(publicKey, cryptoProvider = globalThis.crypto) {
  return sha256Hex(decodeBase64Url(publicKey), cryptoProvider);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function requireObject(value, label) {
  if (!isObject(value)) issue('Invalid', 'invalid-shape', `${label} must be an object.`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) issue('Invalid', 'invalid-field', `${label} must be a nonempty string.`);
  return value;
}

function requireSafeInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) issue('Invalid', 'invalid-field', `${label} must be a safe integer of at least ${minimum}.`);
  return value;
}

function requireExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    issue('Unsupported', 'unsupported-fields', `${label} has missing or unrecognized fields for v1.`);
  }
}

function requireAllowedKeys(value, allowed, label) {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length) issue('Unsupported', 'unsupported-fields', `${label} contains unrecognized v1 fields: ${extra.join(', ')}.`);
}

function recordDigest(record, cryptoProvider) {
  return sha256Hex(record.payload, cryptoProvider);
}

async function prepareTrust(trustAnchors, cryptoProvider) {
  if (!trustAnchors) issue('Incomplete', 'trust-anchors-missing', 'No out-of-band trust-anchor set was provided.');
  requireObject(trustAnchors, 'Trust-anchor set');
  requireExactKeys(trustAnchors, ['schema', 'policy', 'keys'], 'Trust-anchor set');
  if (trustAnchors.schema !== ANCHOR_SCHEMA) issue('Unsupported', 'unsupported-trust-schema', 'The trust-anchor schema is not supported.');
  requireObject(trustAnchors.policy, 'Trust-anchor policy');
  requireExactKeys(trustAnchors.policy, ['reviewer_threshold'], 'Trust-anchor policy');
  if (!Array.isArray(trustAnchors.keys)) issue('Invalid', 'invalid-trust-anchors', 'Trust-anchor keys must be an array.');
  const threshold = requireSafeInteger(trustAnchors.policy?.reviewer_threshold, 'Reviewer threshold', 2);
  const supportedRoles = new Set(['identity', 'contributor', 'evaluator', 'reviewer', 'echo', 'continuator']);
  const keys = new Map();
  for (const entry of trustAnchors.keys) {
    requireObject(entry, 'Trust-anchor key');
    requireExactKeys(entry, ['key_id', 'algorithm', 'public_key', 'subject_identity_id', 'roles'], 'Trust-anchor key');
    const keyId = requireString(entry.key_id, 'Trust-anchor key_id');
    const algorithm = requireString(entry.algorithm, 'Trust-anchor algorithm');
    if (algorithm !== 'Ed25519') issue('Unsupported', 'unsupported-trust-algorithm', `Trust-anchor algorithm ${algorithm} is not supported.`);
    const publicKey = decodeBase64Url(requireString(entry.public_key, 'Trust-anchor public_key'));
    if (publicKey.length !== 32) issue('Invalid', 'invalid-public-key', 'An Ed25519 public key must be 32 bytes.');
    if (await sha256Hex(publicKey, cryptoProvider) !== keyId) issue('Invalid', 'trust-key-id-mismatch', `Trust-anchor key_id ${keyId} does not match its public key.`);
    if (keys.has(keyId)) issue('Invalid', 'duplicate-trust-key', `Trust-anchor key ${keyId} is duplicated.`);
    if (!Array.isArray(entry.roles) || entry.roles.length === 0 || entry.roles.some((role) => !supportedRoles.has(role)) || new Set(entry.roles).size !== entry.roles.length) {
      issue('Invalid', 'invalid-trust-roles', 'Trust-anchor roles must be a nonempty, unique list of supported roles.');
    }
    keys.set(keyId, {
      keyId,
      algorithm,
      publicKey,
      subject: requireString(entry.subject_identity_id, 'Trust-anchor subject_identity_id'),
      roles: entry.roles
    });
  }
  return { threshold, keys };
}

async function verifySignedRecord(record, expectedKind, role, subjectField, expectedSubject, trust, cryptoProvider) {
  requireObject(record, `${expectedKind} record`);
  requireExactKeys(record, ['schema', 'kind', 'payload', 'signed_bytes', 'signature'], `${expectedKind} record`);
  if (record.schema !== RECORD_SCHEMA) issue('Unsupported', 'unsupported-record-schema', `${expectedKind} record schema is not supported.`);
  if (record.kind !== expectedKind) issue('Invalid', 'record-kind-mismatch', `Expected a ${expectedKind} record.`);
  requireObject(record.payload, `${expectedKind} payload`);
  requireObject(record.signature, `${expectedKind} signature`);
  requireExactKeys(record.signature, ['algorithm', 'key_id', 'value'], `${expectedKind} signature`);
  const algorithm = requireString(record.signature.algorithm, `${expectedKind} signature algorithm`);
  if (algorithm !== 'Ed25519') issue('Unsupported', 'unsupported-signature-algorithm', `Signature algorithm ${algorithm} is not supported.`);
  const keyId = requireString(record.signature.key_id, `${expectedKind} signature key_id`);
  const anchor = trust.keys.get(keyId);
  if (!anchor) issue('Incomplete', 'unknown-key', `Signer ${keyId} is not in the supplied trust-anchor set.`);
  if (!anchor.roles.includes(role)) issue('Invalid', 'unauthorized-role', `Trusted key ${keyId} is not authorized for ${role}.`);
  if (anchor.subject !== expectedSubject || record.payload[subjectField] !== expectedSubject) {
    issue('Invalid', 'signer-subject-mismatch', `${expectedKind} signer does not match its declared identity.`);
  }
  const expectedBytes = signedRecordBytes(expectedKind, record.payload);
  const suppliedBytes = decodeBase64Url(requireString(record.signed_bytes, `${expectedKind} signed_bytes`));
  if (encodeBase64Url(expectedBytes) !== encodeBase64Url(suppliedBytes)) {
    issue('Invalid', 'signed-bytes-mismatch', `${expectedKind} signed bytes do not match its canonical payload.`);
  }
  const signature = decodeBase64Url(requireString(record.signature.value, `${expectedKind} signature value`));
  if (signature.length !== 64) issue('Invalid', 'invalid-signature-length', `${expectedKind} Ed25519 signature must be 64 bytes.`);
  let imported;
  try {
    imported = await cryptoProvider.subtle.importKey('raw', anchor.publicKey, { name: 'Ed25519' }, false, ['verify']);
  } catch {
    issue('Unsupported', 'ed25519-unavailable', 'This browser cannot verify Ed25519 with Web Crypto.');
  }
  let valid;
  try { valid = await cryptoProvider.subtle.verify({ name: 'Ed25519' }, imported, signature, suppliedBytes); }
  catch { issue('Unsupported', 'ed25519-unavailable', 'This browser cannot verify Ed25519 with Web Crypto.'); }
  if (!valid) issue('Invalid', 'invalid-signature', `${expectedKind} signature is invalid.`);
  return { keyId, subject: anchor.subject, digest: await recordDigest(record, cryptoProvider) };
}

function addCheck(checks, id, detail) { checks.push({ id, result: 'PASS', detail }); }

function result(status, checks, error = null) {
  if (error) checks.push({ id: error.code, result: error.status.toUpperCase(), detail: error.message });
  const descriptions = {
    Verified: 'All supported public-proof checks passed under the supplied trust policy.',
    Invalid: 'At least one proof failed a supported integrity, signature, or authorization check.',
    Incomplete: 'Required proof material or trusted public keys are missing.',
    Unsupported: 'The bundle uses a schema, algorithm, or rule this verifier does not support.'
  };
  return { status, summary: descriptions[status], checks };
}

function assertSortedUniqueStrings(values, label) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string' || !value)) issue('Invalid', 'invalid-list', `${label} must be an array of nonempty strings.`);
  const sorted = [...values].sort();
  if (new Set(values).size !== values.length || values.some((value, index) => value !== sorted[index])) {
    issue('Invalid', 'noncanonical-list', `${label} must be sorted and contain no duplicates.`);
  }
}

function recomputeEvaluation(payload, contributionItems) {
  if (payload.ruleset !== EVALUATOR) issue('Unsupported', 'unsupported-evaluator', `Evaluation rule ${String(payload.ruleset)} is not supported.`);
  requireObject(payload.challenge, 'Evaluation challenge');
  requireExactKeys(payload.challenge, ['items', 'reward_cap'], 'Evaluation challenge');
  const weights = payload.challenge.items;
  if (!Array.isArray(weights) || weights.length === 0) issue('Invalid', 'invalid-challenge', 'Evaluation challenge must contain weighted items.');
  const ids = [];
  let totalWeight = 0;
  const weightById = new Map();
  for (const item of weights) {
    requireObject(item, 'Weighted challenge item');
    requireExactKeys(item, ['item_id', 'weight'], 'Weighted challenge item');
    const id = requireString(item.item_id, 'Weighted item item_id');
    const weight = requireSafeInteger(item.weight, `Weight for ${id}`, 1);
    ids.push(id);
    totalWeight += weight;
    if (!Number.isSafeInteger(totalWeight)) issue('Invalid', 'weight-overflow', 'Challenge weights exceed safe integer limits.');
    weightById.set(id, weight);
  }
  assertSortedUniqueStrings(ids, 'Challenge item IDs');
  assertSortedUniqueStrings(contributionItems, 'Contribution item IDs');
  const matchedItems = contributionItems.filter((id) => weightById.has(id));
  const matchedWeight = matchedItems.reduce((sum, id) => sum + weightById.get(id), 0);
  const rewardCap = requireSafeInteger(payload.challenge.reward_cap, 'Reward cap');
  const computed = {
    coverage_basis_points: Math.floor((matchedWeight * 10000) / totalWeight),
    matched_item_ids: matchedItems,
    matched_weight: matchedWeight,
    reward_units: Math.min(matchedWeight, rewardCap),
    total_weight: totalWeight
  };
  requireObject(payload.result, 'Evaluation result');
  requireExactKeys(payload.result, ['coverage_basis_points', 'matched_item_ids', 'matched_weight', 'reward_units', 'total_weight'], 'Evaluation result');
  if (canonicalize(payload.result) !== canonicalize(computed)) {
    issue('Invalid', 'evaluation-mismatch', 'The signed evaluation result does not match the published weighted-coverage rule.');
  }
  return computed;
}

/** Verify an AgentChain proof bundle locally. Trust anchors must be supplied out of band. */
export async function verifyProofBundle(input, { trustAnchors, cryptoProvider = globalThis.crypto } = {}) {
  const checks = [];
  try {
    if (!cryptoProvider?.subtle) issue('Unsupported', 'webcrypto-unavailable', 'This browser does not provide Web Crypto in a secure context.');
    try {
      await cryptoProvider.subtle.importKey('raw', new Uint8Array(32), { name: 'Ed25519' }, false, ['verify']);
    } catch {
      issue('Unsupported', 'ed25519-unavailable', 'This browser cannot verify Ed25519 with Web Crypto.');
    }
    let bundle;
    if (typeof input === 'string') bundle = readStrictJson(input);
    else bundle = input;
    requireObject(bundle, 'Proof bundle');
    canonicalize(bundle);
    requireExactKeys(bundle, ['schema', 'bundle_id', 'proofs'], 'Proof bundle');
    if (bundle.schema !== BUNDLE_SCHEMA) issue('Unsupported', 'unsupported-bundle-schema', 'Proof-bundle schema is not supported.');
    requireString(bundle.bundle_id, 'Proof bundle bundle_id');
    const trust = await prepareTrust(trustAnchors, cryptoProvider);
    const proofs = requireObject(bundle.proofs, 'Proof bundle proofs');
    requireAllowedKeys(proofs, ['identity', 'commitment', 'contribution', 'evaluation', 'origin_event', 'echo_lineage', 'continuations', 'review_attestations'], 'Proof bundle proofs');
    for (const name of ['identity', 'commitment', 'contribution', 'evaluation', 'origin_event', 'echo_lineage', 'continuations', 'review_attestations']) {
      if (proofs[name] == null) issue('Incomplete', `missing-${name}`, `Required ${name.replaceAll('_', ' ')} proof is missing.`);
    }
    if (!Array.isArray(proofs.echo_lineage) || !Array.isArray(proofs.continuations) || !Array.isArray(proofs.review_attestations)) issue('Invalid', 'invalid-proof-list', 'Echo lineage, continuation proofs, and reviewer attestations must be arrays.');
    if (trust.keys.size === 0) issue('Incomplete', 'no-trusted-keys', 'The supplied trust-anchor set contains no approved public keys.');

    const identityPayload = requireObject(proofs.identity.payload, 'Identity payload');
    requireExactKeys(identityPayload, ['identity_id', 'key_id', 'key_version'], 'Identity payload');
    const identityId = requireString(identityPayload.identity_id, 'Identity identity_id');
    const identity = await verifySignedRecord(proofs.identity, 'identity', 'identity', 'identity_id', identityId, trust, cryptoProvider);
    if (identityPayload.key_id !== identity.keyId) issue('Invalid', 'identity-key-mismatch', 'Identity key_id does not match the signing key.');
    requireSafeInteger(identityPayload.key_version, 'Identity key_version', 1);
    addCheck(checks, 'identity-signature', 'Identity document is signed by an approved identity key.');

    const commitmentPayload = requireObject(proofs.commitment.payload, 'Commitment payload');
    requireExactKeys(commitmentPayload, ['identity_id', 'document', 'document_digest'], 'Commitment payload');
    if (commitmentPayload.identity_id !== identityId) issue('Invalid', 'commitment-identity-mismatch', 'Commitment identity does not match the proof identity.');
    const commitment = await verifySignedRecord(proofs.commitment, 'commitment', 'contributor', 'identity_id', identityId, trust, cryptoProvider);
    const documentDigest = await sha256Hex(commitmentPayload.document, cryptoProvider);
    if (commitmentPayload.document_digest !== documentDigest) issue('Invalid', 'commitment-digest-mismatch', 'Committed document does not match its SHA-256 digest.');
    addCheck(checks, 'commitment-digest', 'Canonical evidence bytes match the declared SHA-256 commitment.');

    const contributionPayload = requireObject(proofs.contribution.payload, 'Contribution payload');
    requireExactKeys(contributionPayload, ['identity_id', 'commitment_digest', 'item_ids'], 'Contribution payload');
    if (contributionPayload.identity_id !== identityId || contributionPayload.commitment_digest !== commitment.digest) {
      issue('Invalid', 'contribution-reference-mismatch', 'Contribution does not reference the verified identity and commitment.');
    }
    assertSortedUniqueStrings(contributionPayload.item_ids, 'Contribution item IDs');
    await verifySignedRecord(proofs.contribution, 'contribution', 'contributor', 'identity_id', identityId, trust, cryptoProvider);
    addCheck(checks, 'contribution-signature', 'Contribution signature and commitment reference are valid.');

    const evaluationPayload = requireObject(proofs.evaluation.payload, 'Evaluation payload');
    requireExactKeys(evaluationPayload, ['evaluator_id', 'contribution_digest', 'ruleset', 'challenge', 'result'], 'Evaluation payload');
    if (evaluationPayload.contribution_digest !== await recordDigest(proofs.contribution, cryptoProvider)) issue('Invalid', 'evaluation-reference-mismatch', 'Evaluation does not reference the signed contribution.');
    const evaluatorId = requireString(evaluationPayload.evaluator_id, 'Evaluation evaluator_id');
    await verifySignedRecord(proofs.evaluation, 'evaluation', 'evaluator', 'evaluator_id', evaluatorId, trust, cryptoProvider);
    recomputeEvaluation(evaluationPayload, contributionPayload.item_ids);
    addCheck(checks, 'deterministic-evaluation', `Evaluation matches ${EVALUATOR}.`);

    const evaluationDigest = await recordDigest(proofs.evaluation, cryptoProvider);
    if (proofs.review_attestations.length < trust.threshold) issue('Incomplete', 'review-threshold-missing', 'The configured number of reviewer attestations is not present.');
    const reviewerIds = new Set();
    const reviewerKeys = new Set();
    for (const review of proofs.review_attestations) {
      const reviewPayload = requireObject(review.payload, 'Review payload');
      requireExactKeys(reviewPayload, ['reviewer_identity_id', 'evaluation_digest', 'decision'], 'Review payload');
      const reviewerId = requireString(reviewPayload.reviewer_identity_id, 'Review reviewer_identity_id');
      const verifiedReview = await verifySignedRecord(review, 'review', 'reviewer', 'reviewer_identity_id', reviewerId, trust, cryptoProvider);
      if (reviewPayload.evaluation_digest !== evaluationDigest || reviewPayload.decision !== 'approve') issue('Invalid', 'review-reference-mismatch', 'A reviewer attestation does not approve the verified evaluation.');
      if (reviewerIds.has(reviewerId) || reviewerKeys.has(verifiedReview.keyId) || reviewerId === identityId || reviewerId === evaluatorId) {
        issue('Invalid', 'duplicate-reviewer', 'Reviewer attestations must use distinct trusted identities separate from the contributor and evaluator.');
      }
      reviewerIds.add(reviewerId);
      reviewerKeys.add(verifiedReview.keyId);
    }
    addCheck(checks, 'review-attestations', `${reviewerIds.size} distinct trusted reviewer signatures meet the configured threshold of ${trust.threshold}.`);

    const originPayload = requireObject(proofs.origin_event.payload, 'Origin-event payload');
    requireExactKeys(originPayload, ['identity_id', 'event_id', 'commitment_digest', 'evaluation_digest', 'created_at'], 'Origin-event payload');
    const origin = await verifySignedRecord(proofs.origin_event, 'origin-event', 'contributor', 'identity_id', identityId, trust, cryptoProvider);
    if (originPayload.commitment_digest !== commitment.digest || originPayload.evaluation_digest !== evaluationDigest) {
      issue('Invalid', 'origin-reference-mismatch', 'Origin event does not bind the verified commitment and evaluation.');
    }
    const originPayloadDigest = await recordDigest(proofs.origin_event, cryptoProvider);
    if (proofs.echo_lineage.length < 2) issue('Incomplete', 'lineage-incomplete', 'At least an origin Echo and one continued Echo are required.');
    const echoIds = new Set();
    let previous = null;
    for (const echo of proofs.echo_lineage) {
      const payload = requireObject(echo.payload, 'Echo payload');
      requireExactKeys(payload, ['echo_id', 'identity_id', 'generation', 'parent_echo_id', 'parent_echo_digest', 'origin_event_digest', 'commitment_digest', 'evaluation_digest', 'authorized_continuation_identity_ids', 'continuation_digest'], 'Echo payload');
      const echoId = requireString(payload.echo_id, 'Echo echo_id');
      const actorId = requireString(payload.identity_id, 'Echo identity_id');
      if (echoIds.has(echoId)) issue('Invalid', 'duplicate-echo-id', 'Echo IDs in the lineage must be unique.');
      echoIds.add(echoId);
      await verifySignedRecord(echo, 'echo', 'echo', 'identity_id', actorId, trust, cryptoProvider);
      requireSafeInteger(payload.generation, 'Echo generation');
      if (payload.origin_event_digest !== originPayloadDigest || payload.commitment_digest !== commitment.digest || payload.evaluation_digest !== evaluationDigest) {
        issue('Invalid', 'echo-evidence-mismatch', 'Echo lineage does not bind the verified origin, commitment, and evaluation.');
      }
      assertSortedUniqueStrings(payload.authorized_continuation_identity_ids, 'Authorized continuation identities');
      if (!previous) {
        if (payload.generation !== 0 || payload.parent_echo_id !== null || payload.parent_echo_digest !== null || payload.continuation_digest !== null || actorId !== identityId) {
          issue('Invalid', 'invalid-lineage-root', 'The first Echo must be the contributor-signed generation-zero root.');
        }
      } else {
        requireString(payload.continuation_digest, 'Continued Echo continuation_digest');
        if (payload.parent_echo_id !== previous.payload.echo_id || payload.parent_echo_digest !== await recordDigest(previous, cryptoProvider) || payload.generation !== previous.payload.generation + 1) {
          issue('Invalid', 'invalid-parent-link', 'An Echo parent ID, digest, or generation does not match the preceding record.');
        }
      }
      previous = echo;
    }
    addCheck(checks, 'echo-lineage', `${proofs.echo_lineage.length} signed Echo records form a continuous parent-linked chain.`);

    const neededContinuations = proofs.echo_lineage.length - 1;
    if (proofs.continuations.length < neededContinuations) issue('Incomplete', 'continuation-proof-missing', 'A signed continuation authorization is missing for an Echo parent link.');
    if (proofs.continuations.length !== neededContinuations) issue('Invalid', 'continuation-count-mismatch', 'There must be exactly one continuation authorization for each Echo child.');
    for (let index = 0; index < neededContinuations; index += 1) {
      const continuation = proofs.continuations[index];
      const continuationPayload = requireObject(continuation.payload, 'Continuation payload');
      requireExactKeys(continuationPayload, ['actor_identity_id', 'parent_echo_id', 'parent_echo_digest', 'child_echo_id', 'next_generation', 'origin_event_digest', 'commitment_digest'], 'Continuation payload');
      const continuationActor = requireString(continuationPayload.actor_identity_id, 'Continuation actor_identity_id');
      await verifySignedRecord(continuation, 'continuation', 'continuator', 'actor_identity_id', continuationActor, trust, cryptoProvider);
      const parentEcho = proofs.echo_lineage[index];
      const childEcho = proofs.echo_lineage[index + 1];
      const childPayload = childEcho.payload;
      if (continuationPayload.parent_echo_id !== parentEcho.payload.echo_id || continuationPayload.parent_echo_digest !== await recordDigest(parentEcho, cryptoProvider) ||
          continuationPayload.child_echo_id !== childPayload.echo_id || continuationPayload.next_generation !== childPayload.generation ||
          continuationPayload.origin_event_digest !== originPayloadDigest || continuationPayload.commitment_digest !== commitment.digest ||
          !parentEcho.payload.authorized_continuation_identity_ids.includes(continuationActor) ||
          childPayload.identity_id !== continuationActor || childPayload.continuation_digest !== await recordDigest(continuation, cryptoProvider)) {
        issue('Invalid', 'unauthorized-continuation', 'Continuation signer, parent authorization, and child Echo do not agree.');
      }
    }
    addCheck(checks, 'continuation-authorization', `${neededContinuations} parent-authorized continuation(s) match the Echo lineage.`);
    addCheck(checks, 'trusted-keys', `${trust.keys.size} out-of-band trusted keys are configured; proof signers resolve to them.`);
    return result('Verified', checks);
  } catch (error) {
    if (error instanceof ProofIssue) return result(error.status, checks, error);
    return result('Invalid', checks, new ProofIssue('Invalid', 'verification-error', 'The proof bundle could not be verified due to malformed data.'));
  }
}


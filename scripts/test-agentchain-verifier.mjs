import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  encodeBase64Url,
  keyIdFor,
  sha256Hex,
  signedRecordBytes,
  verifyProofBundle
} from '../agentchain/verifier/index.mjs';

const cryptoProvider = webcrypto;
const identities = [
  ['contributor', ['identity', 'contributor', 'echo']],
  ['evaluator', ['evaluator']],
  ['reviewer-1', ['reviewer']],
  ['reviewer-2', ['reviewer']],
  ['delegate', ['echo', 'continuator']]
];
const keys = new Map();
const trustKeys = [];

for (const [identityId, roles] of identities) {
  const pair = await cryptoProvider.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const raw = new Uint8Array(await cryptoProvider.subtle.exportKey('raw', pair.publicKey));
  const publicKey = encodeBase64Url(raw);
  const keyId = await keyIdFor(publicKey, cryptoProvider);
  keys.set(identityId, { ...pair, publicKey, keyId });
  trustKeys.push({ key_id: keyId, algorithm: 'Ed25519', public_key: publicKey, subject_identity_id: identityId, roles });
}

const anchors = { schema: 'agentchain-trust-anchors/1', policy: { reviewer_threshold: 2 }, keys: trustKeys };
const identityId = 'contributor';

async function signRecord(kind, payload, signerId = identityId) {
  const signer = keys.get(signerId);
  const bytes = signedRecordBytes(kind, payload);
  const signature = new Uint8Array(await cryptoProvider.subtle.sign({ name: 'Ed25519' }, signer.privateKey, bytes));
  return {
    schema: 'agentchain-signed-record/1',
    kind,
    payload,
    signed_bytes: encodeBase64Url(bytes),
    signature: { algorithm: 'Ed25519', key_id: signer.keyId, value: encodeBase64Url(signature) }
  };
}

async function makeBundle() {
  const identity = await signRecord('identity', { identity_id: identityId, key_id: keys.get(identityId).keyId, key_version: 1 });
  const document = { artifact_id: 'public-fixture-1', statement: 'synthetic test evidence' };
  const commitment = await signRecord('commitment', {
    identity_id: identityId,
    document,
    document_digest: await sha256Hex(document, cryptoProvider)
  });
  const contribution = await signRecord('contribution', {
    identity_id: identityId,
    commitment_digest: await sha256Hex(commitment.payload, cryptoProvider),
    item_ids: ['alpha', 'gamma']
  });
  const evaluation = await signRecord('evaluation', {
    evaluator_id: 'evaluator',
    contribution_digest: await sha256Hex(contribution.payload, cryptoProvider),
    ruleset: 'agentchain-public-weighted-coverage/1',
    challenge: {
      items: [{ item_id: 'alpha', weight: 3 }, { item_id: 'beta', weight: 2 }, { item_id: 'gamma', weight: 5 }],
      reward_cap: 6
    },
    result: {
      coverage_basis_points: 8000,
      matched_item_ids: ['alpha', 'gamma'],
      matched_weight: 8,
      reward_units: 6,
      total_weight: 10
    }
  }, 'evaluator');
  const evaluationDigest = await sha256Hex(evaluation.payload, cryptoProvider);
  const commitmentDigest = await sha256Hex(commitment.payload, cryptoProvider);
  const originEvent = await signRecord('origin-event', {
    identity_id: identityId,
    event_id: 'event-001',
    commitment_digest: commitmentDigest,
    evaluation_digest: evaluationDigest,
    created_at: '2026-11-04T12:00:00Z'
  });
  const originEventDigest = await sha256Hex(originEvent.payload, cryptoProvider);
  const rootPayload = {
    echo_id: 'echo-root',
    identity_id: identityId,
    generation: 0,
    parent_echo_id: null,
    parent_echo_digest: null,
    origin_event_digest: originEventDigest,
    commitment_digest: commitmentDigest,
    evaluation_digest: evaluationDigest,
    authorized_continuation_identity_ids: ['delegate'],
    continuation_digest: null
  };
  const rootEcho = await signRecord('echo', rootPayload);
  const rootDigest = await sha256Hex(rootPayload, cryptoProvider);
  const continuationPayload = {
    actor_identity_id: 'delegate',
    parent_echo_id: 'echo-root',
    parent_echo_digest: rootDigest,
    child_echo_id: 'echo-child',
    next_generation: 1,
    origin_event_digest: originEventDigest,
    commitment_digest: commitmentDigest
  };
  const continuation = await signRecord('continuation', continuationPayload, 'delegate');
  const childPayload = {
    echo_id: 'echo-child',
    identity_id: 'delegate',
    generation: 1,
    parent_echo_id: 'echo-root',
    parent_echo_digest: rootDigest,
    origin_event_digest: originEventDigest,
    commitment_digest: commitmentDigest,
    evaluation_digest: evaluationDigest,
    authorized_continuation_identity_ids: [],
    continuation_digest: await sha256Hex(continuationPayload, cryptoProvider)
  };
  const childEcho = await signRecord('echo', childPayload, 'delegate');
  const reviewAttestations = [];
  for (const reviewer of ['reviewer-1', 'reviewer-2']) {
    reviewAttestations.push(await signRecord('review', {
      reviewer_identity_id: reviewer,
      evaluation_digest: evaluationDigest,
      decision: 'approve'
    }, reviewer));
  }
  return {
    schema: 'agentchain-proof-bundle/1',
    bundle_id: 'synthetic-fixture-only',
    proofs: {
      identity,
      commitment,
      contribution,
      evaluation,
      review_attestations: reviewAttestations,
      origin_event: originEvent,
      echo_lineage: [rootEcho, childEcho],
      continuations: [continuation]
    }
  };
}

async function resign(record, kind, signerId) {
  const payload = record.payload;
  Object.assign(record, await signRecord(kind, payload, signerId));
  return record;
}

const valid = await makeBundle();
const verified = await verifyProofBundle(valid, { trustAnchors: anchors, cryptoProvider });
assert.equal(verified.status, 'Verified', JSON.stringify(verified, null, 2));
const verifiedJson = await verifyProofBundle(JSON.stringify(valid), { trustAnchors: anchors, cryptoProvider });
assert.equal(verifiedJson.status, 'Verified');

const corruptedSignature = structuredClone(valid);
corruptedSignature.proofs.contribution.signature.value = `A${corruptedSignature.proofs.contribution.signature.value.slice(1)}`;
assert.equal((await verifyProofBundle(corruptedSignature, { trustAnchors: anchors, cryptoProvider })).status, 'Invalid');

const changedEvidence = structuredClone(valid);
changedEvidence.proofs.commitment.payload.document.statement = 'altered evidence';
await resign(changedEvidence.proofs.commitment, 'commitment', identityId);
const changedEvidenceResult = await verifyProofBundle(changedEvidence, { trustAnchors: anchors, cryptoProvider });
assert.equal(changedEvidenceResult.status, 'Invalid');
assert.equal(changedEvidenceResult.checks.at(-1).id, 'commitment-digest-mismatch');

const invalidParent = structuredClone(valid);
invalidParent.proofs.echo_lineage[1].payload.parent_echo_id = 'missing-parent';
await resign(invalidParent.proofs.echo_lineage[1], 'echo', 'delegate');
const invalidParentResult = await verifyProofBundle(invalidParent, { trustAnchors: anchors, cryptoProvider });
assert.equal(invalidParentResult.status, 'Invalid');
assert.equal(invalidParentResult.checks.at(-1).id, 'invalid-parent-link');

const unauthorizedContinuation = structuredClone(valid);
const root = unauthorizedContinuation.proofs.echo_lineage[0];
root.payload.authorized_continuation_identity_ids = [];
await resign(root, 'echo', identityId);
const newRootDigest = await sha256Hex(root.payload, cryptoProvider);
const continuation = unauthorizedContinuation.proofs.continuations[0];
continuation.payload.parent_echo_digest = newRootDigest;
await resign(continuation, 'continuation', 'delegate');
const child = unauthorizedContinuation.proofs.echo_lineage[1];
child.payload.parent_echo_digest = newRootDigest;
child.payload.continuation_digest = await sha256Hex(continuation.payload, cryptoProvider);
await resign(child, 'echo', 'delegate');
const unauthorizedResult = await verifyProofBundle(unauthorizedContinuation, { trustAnchors: anchors, cryptoProvider });
assert.equal(unauthorizedResult.status, 'Invalid');
assert.equal(unauthorizedResult.checks.at(-1).id, 'unauthorized-continuation');

const unknownKeys = structuredClone(anchors);
unknownKeys.keys = unknownKeys.keys.filter((entry) => entry.subject_identity_id !== 'reviewer-1');
const unknownKeyResult = await verifyProofBundle(valid, { trustAnchors: unknownKeys, cryptoProvider });
assert.equal(unknownKeyResult.status, 'Incomplete');
assert.equal(unknownKeyResult.checks.at(-1).id, 'unknown-key');

const missingProof = structuredClone(valid);
delete missingProof.proofs.contribution;
const missingResult = await verifyProofBundle(missingProof, { trustAnchors: anchors, cryptoProvider });
assert.equal(missingResult.status, 'Incomplete');
assert.equal(missingResult.checks.at(-1).id, 'missing-contribution');

const unsupportedAlgorithm = structuredClone(valid);
unsupportedAlgorithm.proofs.contribution.signature.algorithm = 'ML-DSA-65';
const unsupportedResult = await verifyProofBundle(unsupportedAlgorithm, { trustAnchors: anchors, cryptoProvider });
assert.equal(unsupportedResult.status, 'Unsupported');
assert.equal(unsupportedResult.checks.at(-1).id, 'unsupported-signature-algorithm');

const badBytes = structuredClone(valid);
badBytes.proofs.contribution.signed_bytes = encodeBase64Url(new Uint8Array([1, 2, 3]));
const badBytesResult = await verifyProofBundle(badBytes, { trustAnchors: anchors, cryptoProvider });
assert.equal(badBytesResult.status, 'Invalid');
assert.equal(badBytesResult.checks.at(-1).id, 'signed-bytes-mismatch');

const wrongRuleOutput = structuredClone(valid);
wrongRuleOutput.proofs.evaluation.payload.result.reward_units = 5;
await resign(wrongRuleOutput.proofs.evaluation, 'evaluation', 'evaluator');
const wrongResult = await verifyProofBundle(wrongRuleOutput, { trustAnchors: anchors, cryptoProvider });
assert.equal(wrongResult.status, 'Invalid');
assert.equal(wrongResult.checks.at(-1).id, 'evaluation-mismatch');

const unsupportedRule = structuredClone(valid);
unsupportedRule.proofs.evaluation.payload.ruleset = 'agentchain-weighted-set-coverage/unknown';
await resign(unsupportedRule.proofs.evaluation, 'evaluation', 'evaluator');
const unsupportedRuleResult = await verifyProofBundle(unsupportedRule, { trustAnchors: anchors, cryptoProvider });
assert.equal(unsupportedRuleResult.status, 'Unsupported');
assert.equal(unsupportedRuleResult.checks.at(-1).id, 'unsupported-evaluator');

const noAnchorsResult = await verifyProofBundle(valid, { trustAnchors: { ...anchors, keys: [] }, cryptoProvider });
assert.equal(noAnchorsResult.status, 'Incomplete');

const duplicateProperty = await verifyProofBundle('{"schema":"agentchain-proof-bundle/1","schema":"agentchain-proof-bundle/1"}', { trustAnchors: anchors, cryptoProvider });
assert.equal(duplicateProperty.status, 'Invalid');
assert.equal(duplicateProperty.checks.at(-1).id, 'duplicate-json-key');

const unsupportedCertificate = structuredClone(valid);
unsupportedCertificate.proofs.validator_certificate = { certificate: 'not-defined-in-v1' };
const certificateResult = await verifyProofBundle(unsupportedCertificate, { trustAnchors: anchors, cryptoProvider });
assert.equal(certificateResult.status, 'Unsupported');
assert.equal(certificateResult.checks.at(-1).id, 'unsupported-fields');

const noEd25519Crypto = {
  subtle: {
    digest: (...args) => cryptoProvider.subtle.digest(...args),
    importKey: async () => { throw new Error('Ed25519 unavailable'); }
  }
};
const browserSupportResult = await verifyProofBundle(valid, { trustAnchors: anchors, cryptoProvider: noEd25519Crypto });
assert.equal(browserSupportResult.status, 'Unsupported');
assert.equal(browserSupportResult.checks.at(-1).id, 'ed25519-unavailable');

console.log('AGENTCHAIN_VERIFIER_TESTS=PASS cases=16');


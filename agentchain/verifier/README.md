# AgentChain Public Proof Verifier v1

This directory contains a dependency-free browser SDK for locally checking an `agentchain-proof-bundle/1`. It is independent of the owner-controlled loopback workbench. The SDK does not make network requests; the Sovereign City page reads only its static trust-anchor file and the proof file selected by the visitor. The public overview is at `/agentchain/verifier/`.

```js
import { verifyProofBundle } from '/agentchain/verifier/index.mjs';

const report = await verifyProofBundle(bundleObject, { trustAnchors });
console.log(report.status, report.checks);
```

`bundleObject` may be parsed JSON or a JSON string. String input is parsed with duplicate-property rejection. Every signed record also carries the exact canonical bytes that the signature covers. `verifyProofBundle` never trusts keys supplied inside a proof bundle; callers must provide a separate, curated `agentchain-trust-anchors/1` object.

For another static website, copy this single ES module into that site and pass the site's own curated trust anchors. It has no import dependencies and does not call back to AgentChain or to the workbench.

## Current publication boundary

The published trust-anchor set currently contains no public keys. The site therefore cannot return `Verified` for a real identity yet; it will report `Incomplete` for unknown signers. No public proof examples are included because no sanitized example has been approved. This is deliberate: no key, contribution, review, or Echo record is invented or presented as public evidence.

The local Proof of Agency profile documents weighted set coverage but does not publish its cross-language wire format or its exact evaluator rules. This SDK publishes a separate, explicitly versioned rule, `agentchain-public-weighted-coverage/1`. Passing that rule proves that the bundle matches this public rule; it does not claim equivalence with the private/local evaluator.

Validator certificates are not supported in v1. No public certificate format or trusted validator set is defined in this repository, so a validator certificate or other unrecognized field is reported as `Unsupported` rather than treated as verified.

## Bundle shape

The top-level object contains `schema: "agentchain-proof-bundle/1"`, a nonempty `bundle_id`, and `proofs` with these required signed records:

| Field | Signed `kind` | Required binding |
| --- | --- | --- |
| `identity` | `identity` | Identity ID, key ID, and key version |
| `commitment` | `commitment` | Identity ID, public document, and SHA-256 digest of that document |
| `contribution` | `contribution` | Identity ID, commitment-record digest, and sorted item IDs |
| `evaluation` | `evaluation` | Evaluator ID, contribution-record digest, public rule ID, challenge, and result |
| `review_attestations[]` | `review` | Reviewer identity, evaluation-record digest, and `approve` decision |
| `origin_event` | `origin-event` | Contributor identity, commitment digest, and evaluation digest |
| `echo_lineage[]` | `echo` | Echo ID, identity, generation, parent ID and digest, origin/evidence/evaluation references, and allowed continuation identities |
| `continuations[]` | `continuation` | One per child Echo: parent Echo and digest, child Echo, next generation, authorized actor, origin, and commitment |

Each signed record is `{schema, kind, payload, signed_bytes, signature}`. The signature is `{algorithm, key_id, value}`; v1 accepts only Ed25519. `signed_bytes` is unpadded base64url of the UTF-8 bytes of the canonical JSON object `{domain:"AgentChain Public Proof Record",schema:"agentchain-signed-record/1",kind,payload}`. The signature must verify over those exact decoded bytes. The `key_id` is lowercase hex SHA-256 of the 32 raw public-key bytes.

AgentChain Canonical JSON v1 sorts object keys by JavaScript UTF-16 string order, keeps array order, uses UTF-8, and permits only null, booleans, strings without unpaired surrogates, arrays, objects, and safe integers (no floats or negative zero). Duplicate JSON properties are rejected. Record digests are lowercase hex SHA-256 over the UTF-8 canonical serialization of the record payload. The evidence commitment uses that same digest procedure over `commitment.payload.document`.

## Public evaluation rule

`agentchain-public-weighted-coverage/1` uses a challenge with sorted, unique `{item_id, weight}` entries and a nonnegative integer `reward_cap`. Every weight is a positive safe integer. Contribution `item_ids` are sorted and unique. The result must equal all of the following recomputed fields:

- `matched_item_ids`: contribution IDs present in the challenge, sorted lexicographically.
- `total_weight`: the sum of all challenge weights.
- `matched_weight`: the sum for matched IDs.
- `coverage_basis_points`: floor of `matched_weight * 10000 / total_weight`.
- `reward_units`: the smaller of `matched_weight` and `reward_cap`.

Changing any evidence, reference digest, list ordering, weight, cap, or result invalidates the affected check. Unknown rule IDs and algorithms are `Unsupported`, not passes.

## Trust policy and status meanings

Trust anchors are supplied out of band and never read from the user proof. Each key entry binds a derived key ID, Ed25519 raw public key, identity subject, and permitted roles (`identity`, `contributor`, `evaluator`, `reviewer`, `echo`, `continuator`). The trust set also defines `policy.reviewer_threshold`; the current site policy is two. A reviewer key must be trusted for `reviewer`, approve the exact evaluation digest, and be a distinct identity/key from the contributor and evaluator. This validates signatures and threshold; it cannot establish real-world reviewer independence. Each child in a multi-generation Echo chain must have its own signed continuation record.

- **Verified**: every required proof, signature, reference, public evaluation, configured review threshold, parent link, and continuation authorization passed against the supplied trust anchors.
- **Invalid**: a supported integrity, signature, reference, rule, or authorization check failed.
- **Incomplete**: required evidence or a trusted key is absent.
- **Unsupported**: a schema version, algorithm, or evaluation rule is not implemented.

No status establishes the truth or usefulness of a contribution, consensus finality, production deployment, settlement, or value execution. `Verified` means only that the public bundle meets the implemented v1 checks and the caller's trust policy.

## Browser and privacy boundary

The SDK uses only Web Crypto SHA-256 and Ed25519 verification. It has no dependencies, signing functions, RPC calls, localhost requests, external services, or storage. The UI reads the selected JSON file in memory in the visitor's browser and does not upload it. Public-page verification requires a secure browser context and a browser that supports Web Crypto Ed25519; otherwise the result is `Unsupported`.

The schema is in `agentchain-proof-bundle.schema.json`. The implementation and tests do not include actual identities, trust keys, private workbench records, or a public evidence example.

The Sovereign City public page labels the workbench as an owner-controlled local capability and never displays its execution button on GitHub Pages. That button is revealed only when the page is served from the configured owner loopback origin. Public proof verification is a separate read-only browser feature; it does not contact the workbench.

## Checks and current limitations

The website workflow runs the static link/asset/import check, JavaScript syntax checks, the existing AgentChain demo and Sovereign City suites, and 16 focused verifier cases. The verifier cases use temporary generated signing keys only in memory to exercise the public format; they are not published as trusted keys or proof examples. These checks run under Node's Web Crypto implementation and do not constitute real-browser testing. The public site still has no approved trust keys or genuine public evidence bundle, so independently verifiable real-world evidence is not currently available.

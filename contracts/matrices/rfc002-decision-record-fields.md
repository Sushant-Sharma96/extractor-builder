# RFC-002 §2.2 Decision Record Field Matrix

| RFC-002 field | Schema property | Required | Covered by fixtures |
|---------------|-----------------|----------|---------------------|
| id | `id` | yes | winner, abstain, overridden |
| subject | `subject` | yes | all three |
| question | `question` | yes | all three |
| candidates[] | `candidates` | yes | all three |
| evidence[] | `evidence` | yes | all three |
| scores[] | `scores` | yes | all three |
| ranking | `ranking` | yes | all three |
| winner | `winner` (`kind: candidate` \| `kind: abstain`) | yes | winner+override use candidate; abstain uses abstain |
| policy | `policy` | yes | all three |
| status | `status` enum | yes | arbitrated / overridden |
| alternatives_kept | `alternatives_kept` | yes | all three |
| trace_refs | `trace_refs` | yes | all three |

**Status enum:** `proposed`, `arbitrated`, `overridden`, `fallen-back`, `rejected`  
**Override detail:** optional `override` object when `status=overridden`

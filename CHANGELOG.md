# Changes

## 0.1.0 (27 Nov 2026)

First published release.

- Mail off by default for a hosted installation: `MAIL_PROVIDER=none` needs no sender or mail key, every send is refused with `mail_off` without contacting a provider, and the owner signs in with `rer signin` (new migration `202611270100_owner_signin.sql` adds the `oa_owner_signins` table it writes).
- RER 0.2.143. The demo workflow deploys each published release at its tag.
- The agent surface declares the written job record for its quote journey step.
- RELEASE.json lists all 60 core migrations.

# Explicit application home

`ZCODE_APPLICATION_HOME` opts a local UI development instance into an isolated application home. The Node-only public resolver `@zcode/shared/application-home` validates the absolute path and rejects the real OS home and its production configuration trees. It has precedence over legacy application storage/configuration roots. Empty/unset input preserves existing CLI defaults.

Global config, skills, commands, AGENTS.md, session DB, logs/rollouts, workflows, credentials and device state use this root. Project/workspace selection and OS identity retain their existing meaning. Desktop passes the explicit application/data/storage paths to Agent children and never changes HOME, USERPROFILE or CODEX_HOME to redirect configuration. Credential encryption and authorization are unchanged.

Acceptance covers both the isolated root and ordinary CLI defaults, including a clean child environment and default configuration file expansion. This is not a filesystem sandbox for arbitrary user tools. See the complete launch and runtime acceptance contract in `docs/desktop/application-home-isolation.md` at the repository root.

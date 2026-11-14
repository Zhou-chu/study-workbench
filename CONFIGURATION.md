# Configuration Guide

**📍 This file has moved!**

All configuration documentation has been consolidated into the new documentation structure.

👉 **[Read the Configuration Guide](docs/5-CONFIGURATION/index.md)**

---

## Quick Links

- **AI Provider Setup** → [AI Providers](docs/5-CONFIGURATION/ai-providers.md)
- **Environment Variables Reference** → [Environment Reference](docs/5-CONFIGURATION/environment-reference.md)
- **Database Configuration** → [Database Setup](docs/5-CONFIGURATION/database.md)
- **Security Setup** → [Security Configuration](docs/5-CONFIGURATION/security.md)
- **Reverse Proxy** → [Reverse Proxy Setup](docs/5-CONFIGURATION/reverse-proxy.md)
- **Advanced Tuning** → [Advanced Configuration](docs/5-CONFIGURATION/advanced.md)

---

## What You'll Find

The new configuration documentation includes:

- **Complete environment variable reference** with examples
- **Provider-specific setup guides** for OpenAI, Anthropic, Google, Groq, Ollama, and more
- **Production deployment configurations** with security best practices
- **Reverse proxy examples** for Nginx, Caddy, Traefik
- **Database tuning** for performance optimization
- **Troubleshooting guides** for common configuration issues

---

For all configuration details, see **[docs/5-CONFIGURATION/](docs/5-CONFIGURATION/index.md)**.

### Gated device-session backend

`STUDY_WORKBENCH_AUTH_MODE=legacy_password` is the compatibility default.
`device_sessions` opts into the strict backend; unknown values fail closed.
**Do not enable on an existing Web runtime until the matching BFF/cookie/CSRF
migration and ingress acceptance pass.** This backend change alone is not that
activation. One API process is required; restarting requires all clients to log
in again. Strict `_FILE` credentials never fall back to environment passwords.

`STUDY_WORKBENCH_AUTH_ORIGINS` lists exact allowed origins, comma-separated,
e.g. `https://study.example.com`. Wildcards and paths are invalid. An empty list
rejects all supplied origins; explicit native requests may omit Origin. No
request Host or forwarded IP header establishes trust. All HTTP callers conservatively share the five-failed-logins/minute bucket;
ASGI client addresses may already be proxy-rewritten and are not trusted.
Native clients use the session routes in `docs/v1/DEVICE_SESSION_PROTOCOL.md`;
password Bearer never works in device mode. Lost refresh acknowledgement needs
fresh login, not refresh retry. Session secrets must not be logged or exported.

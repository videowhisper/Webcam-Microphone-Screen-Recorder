# Security Policy

Report security issues privately to the VideoWhisper maintainer before public
disclosure.

## Security Defaults

- Browser capture requires HTTPS outside localhost.
- Recording stays local until the user accepts.
- Uploads use multipart POST through an adapter.
- The PHP demo validates upload size, MIME type, owner cookie, and storage path.
- Admin media browsing requires login.
- Media files are served through controlled endpoints.
- Cleanup has a CLI path and lock file.

## Production Checklist

- Replace the demo admin password and HMAC secret.
- Put PHP storage outside the public web root where possible.
- Configure explicit CORS only when cross-origin embedding is required.
- Add CAPTCHA, quotas, and malware scanning before running a public anonymous
  upload demo.
- Use HTTPS and set a stricter CSP for your deployment host.

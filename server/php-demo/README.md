# VideoWhisper Webcam, Microphone & Screen Recorder - PHP Demo

Backend demo for the **Online browser video and audio recorder for webcam,
microphone, screen capture, screenshots and photos.**

This is a zero-framework PHP 8.2+ backend for the recorder demo.

## Run Locally

```bash
php -S 127.0.0.1:8080 -t public
```

Then set the Vite demo upload endpoint to `/api/uploads` through the built-in
toggle when both apps are served from the same host, or proxy requests through
your web server.

Default local admin credentials are `admin` / `admin`. For a persistent local or
hosted setup, copy the protected example file and replace every value:

```bash
cp config/credentials.example.php config/credentials.php
```

`config/credentials.php` is outside the intended `public/` document root,
blocked by the included Apache rule, ignored by Git, and excluded from source
exports. Keep it readable only by the required server account. Environment
variables can be used instead and take priority over the file:

```bash
export VW_RECORDER_ADMIN_USER="admin"
export VW_RECORDER_ADMIN_PASSWORD="use-a-long-password"
export VW_RECORDER_HMAC_SECRET="use-a-random-secret"
```

The protected media admin page includes a collapsed credential-settings section
below the media list. Its brief title warns when defaults remain active and
opens the setup instructions when clicked. Changing the HMAC secret invalidates
existing anonymous owner cookies, so keep it stable after deployment.
Administrator sessions are also bound to the current credentials and HMAC;
rotating either requires administrators to log in again.

## Cleanup Cron

```cron
17 * * * * /usr/bin/php /path/to/server/php-demo/bin/cleanup.php >/dev/null 2>&1
```

Before enabling cleanup on an existing installation, back up its database and
media. A deployment configuration can supply `retention.protected_ids` as an
array of existing media IDs. Those IDs are excluded from both age limits
(including the absolute limit) and per-type count cleanup. Keep that ledger
outside the public document root and fail closed if it cannot be loaded.
Set `cleanup.run_probability` to `0` when cleanup should run only through the
scheduled CLI command or an administrator. Protection applies to automated
retention; an administrator can still deliberately delete an item.

Run the isolated backend regression check from the source workspace:

```bash
php tests/php-backend-security.php
```

The demo stores media in `storage/media`, thumbnails in `storage/thumbnails`,
and structured recorder metadata in SQLite. Stored filenames include duration
and resolution when applicable for convenient inspection, while integrations
should use the structured `mediaInfo` contract rather than parse filenames.
Media files are served through `/media?id=...` so directory listing and
arbitrary path access are avoided.

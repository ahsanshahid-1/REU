# Request to CRC: reverse-proxy `/api` to the REU Node app

## What we need

The REU recruitment site is served statically by Apache from `/var/www/reu` on
the `reu` container. The dynamic backend (account login, application submission,
and the chat assistant) runs as a Node process on `127.0.0.1:3000` in the same
container. Right now Apache only serves the static files, so every request the
browser makes to `/api/...` returns 404 and the login/apply/chat features can't
reach the backend.

We cannot make this change ourselves: the container has `no_new_privileges`
set, so we have no sudo/root to enable modules or edit the vhost. We're
requesting that CRC apply the change below.

## The change (two parts)

**1. Enable the proxy modules (once):**

```bash
sudo a2enmod proxy proxy_http
```

**2. Add a proxy block to the site vhost** `/etc/apache2/sites-available/reu.conf`,
inside the `<VirtualHost>` block (both the `:80` and, if present, the `:443`
vhost for `reu.crc.ualr.edu`):

```apache
    # Forward API calls to the local Node app; static files stay on Apache.
    ProxyPreserveHost On
    ProxyPass        /api  http://127.0.0.1:3000/api
    ProxyPassReverse /api  http://127.0.0.1:3000/api
    # The assistant can take ~60s to generate on CPU; allow headroom.
    ProxyTimeout     130
```

Then:

```bash
sudo apache2ctl configtest && sudo systemctl reload apache2
```

## For reference — the full vhost with the block added

```apache
<VirtualHost *:80>
    ServerName reu.crc.ualr.edu
    ServerAdmin webmaster@localhost
    DocumentRoot /var/www/reu

    ProxyPreserveHost On
    ProxyPass        /api  http://127.0.0.1:3000/api
    ProxyPassReverse /api  http://127.0.0.1:3000/api
    ProxyTimeout     130

    ErrorLog ${APACHE_LOG_DIR}/error.log
    CustomLog ${APACHE_LOG_DIR}/access.log combined
</VirtualHost>
```

(If TLS for `reu.crc.ualr.edu` is terminated in a separate `:443` vhost, add the
same three `Proxy*` lines there too — that's the one the browser actually hits.)

## How to verify it worked

```bash
curl -s http://127.0.0.1:3000/api/health      # {"ok":true}  (backend, already true)
curl -sk https://reu.crc.ualr.edu/api/health  # should now ALSO return {"ok":true}
```

Once the second command returns `{"ok":true}`, the login, application, and chat
features work on the live site. No other changes are needed; the Node app keeps
running on 127.0.0.1:3000 and Apache continues to serve the static pages.

## Notes

- Only the `/api` path is proxied; all static content is still served directly
  by Apache, so there's no performance or caching change for normal pages.
- The Node app already honors `X-Forwarded-*` (it runs with `TRUST_PROXY=true`),
  so client IPs are logged correctly through the proxy.
- The app listens only on the loopback interface (`127.0.0.1:3000`), so it is
  not directly reachable from outside — Apache remains the only public entry.

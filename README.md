# Character Phone Network — Clean Restart

This project starts from the seven original uploaded phone HTML files.

## Preserved

- Every phone remains one self-contained character HTML file.
- Every original app, icon, panel, message sample, theme, and navigation handler remains present.
- No character app list has been standardized.
- The shared network only adds a two-tab area inside each existing Messages app:
  - **Live Network** — real connected messages.
  - **Saved Threads** — the original hard-coded character conversations.

## Included phones

- Jacey “Jace” Cosmo: `phones/jace.html`
- Damian Crosse: `phones/damian.html`
- Meggie Harmon: `phones/meggie.html`
- Juno Enyo: `phones/juno.html`
- Aria Matsuda: `phones/aria.html`
- Kouji Renran Yoshinari: `phones/kouji.html`
- Tyler “Ty” Ezra: `phones/tyler.html`

## Test locally

Open `index.html`, then open two phones in separate tabs.

1. Open each phone’s existing Messages app.
2. Select **Live Network**.
3. Choose the other character.
4. Send a message.

Without configuration, the phones communicate through `localStorage`. This works between tabs in the same browser.

For best results, serve the folder instead of opening it through `file://`:

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000`.

## Enable free online communication with Supabase

1. Create a free Supabase project.
2. Open its SQL Editor.
3. Run `supabase/schema.sql`.
4. In Supabase, ensure Realtime is enabled for `phone_messages`.
5. Edit `shared/supabase-config.js`:

```js
window.PHONE_NETWORK_CONFIG = {
  enabled: true,
  supabaseUrl: "https://YOUR-PROJECT.supabase.co",
  supabaseAnonKey: "YOUR-ANON-PUBLIC-KEY"
};
```

6. Host the folder on GitHub Pages, Netlify, Cloudflare Pages, or another static host.

Never place a Supabase `service_role` key in these HTML or JavaScript files. Only use the public anon key.

## Adding future phones

A future phone can remain a single HTML file.

It needs:

1. A Messages app with `id="messages"`.
2. Its normal app navigation, unchanged.
3. A roster entry in `shared/phone-network.js`.
4. These four lines immediately before `</body>`:

```html
<link rel="stylesheet" href="../shared/network-ui.css">
<script>
window.PHONE_IDENTITY = { id: "new-character-id" };
</script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="../shared/supabase-config.js"></script>
<script src="../shared/phone-network.js"></script>
```

The shared script discovers the existing Messages app and injects the network interface. It does not alter the character’s other apps.

## Security note

The supplied SQL policies are intentionally permissive for a fictional prototype: anyone who can access the public site can read the fictional message table and send as one of the registered character IDs. Add real authentication and stricter policies before using the system for private or user-generated communication.

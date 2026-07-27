# Character Phone Network v2 — Native Messages

This version integrates live communication directly into each phone's original Messages app.

## What changed

- The extra **Live Network / Saved Threads** tabs are gone.
- Each Messages app now opens to a normal contact list.
- Selecting a contact opens one continuous conversation.
- The phone's original hardcoded conversation appears first as permanent saved history.
- Messages sent through Supabase or local testing appear beneath it as live history.
- A **Reset sent messages** control removes only live/network messages.
- Hardcoded messages remain because they still live in the original HTML.

## Included phones

- Jacey “Jace” Cosmo: `phones/jace.html`
- Damian Crosse: `phones/damian.html`
- Meggie Harmon: `phones/meggie.html`
- Juno Enyo: `phones/juno.html`
- Aria Matsuda: `phones/aria.html`
- Kouji Renran Yoshinari: `phones/kouji.html`
- Tyler “Ty” Ezra: `phones/tyler.html`

## Important: update your existing Supabase project

Because the reset feature needs delete permission, run the updated:

```text
supabase/schema.sql
```

You can run the complete file again. It safely recreates the policies and adds the reset/delete policy.

## Configure Supabase

Edit:

```text
shared/supabase-config.js
```

Use:

```js
window.PHONE_NETWORK_CONFIG = {
  enabled: true,
  supabaseUrl: "https://YOUR-PROJECT.supabase.co",
  supabaseAnonKey: "YOUR-PUBLISHABLE-OR-ANON-KEY"
};
```

Never use a `service_role` or secret key in these files.

## Test before GitHub

From the project folder:

```bash
python -m http.server 8000
```

Open:

```text
http://localhost:8000
```

Open two phones in separate tabs and send messages between them.

## Reset behavior

The **Reset sent messages** button appears at the top of every Messages app.

After confirmation, it deletes all rows in `phone_messages`, including messages sent by any person using any of the character phones. It does not affect the hardcoded messages embedded in the HTML.

This is intentionally a shared prototype reset. There is no user authentication yet, so anyone with access to the hosted phones can use it.

## GitHub Pages

After testing:

1. Upload the entire folder to a GitHub repository.
2. Keep `index.html`, `phones`, and `shared` together.
3. Enable Pages from the `main` branch and repository root.

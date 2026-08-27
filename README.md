# Custom‑Pay

Generate themed, sticker‑style UPI QR codes with a custom (or open) amount — no backend, runs entirely in the browser.

## What it does

1. You enter your **UPI ID (VPA)**, payee name, an optional note, and either leave the amount open (payer types their own) or lock a **fixed amount**.
2. It builds a standard UPI deep link:
   ```
   upi://pay?pa=<your-vpa>&pn=<name>&am=<amount>&cu=INR&tn=<note>
   ```
3. The QR itself is rendered in plain black‑on‑white for maximum scanner reliability — any UPI app (GPay, PhonePe, Paytm, BHIM, etc.) can read it.
4. A themed "holo sticker card" frame is drawn around it — pick from 4 skins (Healing Noir, Chrome Pop, Mint Static, Candy Rush).
5. Download the finished card as a PNG, or copy the raw UPI link.

## Run it

No build step, no install. Just open `index.html` in a browser:

```bash
# from inside the Custom-Pay folder
python3 -m http.server 8000
# then visit http://localhost:8000
```

Or just double‑click `index.html` — it works as a static file too (some browsers restrict clipboard-copy on `file://`, so a local server is the safer bet).

## Deploy it for free

Any static host works — drag the folder in:
- **Netlify** — drag-and-drop the `Custom-Pay` folder at app.netlify.com/drop
- **Vercel** — `vercel deploy` from inside the folder
- **GitHub Pages** — push to a repo, enable Pages on the `main` branch

## Project structure

```
Custom-Pay/
├── index.html      # markup + form + card structure
├── css/style.css   # design tokens + 4 theme skins
├── js/app.js       # UPI link builder, QR render, download/copy
└── README.md
```

## Customizing / adding a new theme

1. In `index.html`, add a new `.sticker-swatch` button inside `#themeRow` with a unique `data-theme="yourname"` and `--sw-a` / `--sw-b` swatch colors.
2. In `js/app.js`, add an entry to `themeCharms` for the center-charm glyph.
3. In `css/style.css`, add a matching block:
   ```css
   .holo-card[data-theme="yourname"]{
     background: linear-gradient(155deg, #colorA, #colorB 60%);
     --mascot-fill:#...; --mascot-eye-bg:#...;
   }
   .holo-card[data-theme="yourname"] .amt-pill{ background:#...; color:#...; }
   ```

## Notes & limits

- This is a client-side link/QR generator — it does **not** move money, verify a VPA with a bank, or process payments itself. Scanning apps handle the actual transaction, exactly as if you'd typed the UPI ID manually.
- Double‑check your UPI ID before sharing a generated code — an invalid or mistyped VPA will fail at the paying app, not at generation time.
- The download button uses `html2canvas` to snapshot the card, so very old browsers may render it slightly differently than the live preview.

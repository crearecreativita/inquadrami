# INQUADRAMI

QR code brandizzati che si leggono davvero. Un tool di [Creare Creatività](https://www.crearecreativita.it).

Tutto client-side: nessun backend, nessun dato inviato. Tre file statici, zero build.

## Cosa fa

- Codifica URL/testo **oppure un contatto** (vCard 3.0 minimale: nome, cognome, azienda, telefono, email, sito) con correzione errori **H** (30%), fissa. Mostra moduli, caratteri e dimensione minima di stampa consigliata (0,6 mm per modulo).
- Personalizza forma dei moduli (quadrato / cerchio / goccia / tondo), angoli, colore pieno o gradiente, sfondo.
- Logo centrale con area di sicurezza calcolata sul budget di correzione H.
- Cornice brandizzata con colore, raggio e call to action.
- **Verifica obbligatoria**: ogni modifica viene rasterizzata e ridecodificata con jsQR in grande (10 px/modulo, min 800px) e a tre scale ridotte (6, 7, 8 px/modulo, passa con 2 su 3: jsQR ha falsi negativi di aliasing a scale isolate). Il download si sblocca solo con il check verde.
- Export **SVG** (vettoriale, per stampa) e **PNG** a 1024 / 2048 / 4096px (con Be Vietnam Pro incorporata nella CTA).

## Deploy su GitHub Pages

1. Crea un repo (es. `inquadrami`) e carica `index.html`, `style.css`, `app.js`.
2. Settings → Pages → Source: *Deploy from a branch* → `main` / root.
3. Il tool è online su `https://<utente>.github.io/inquadrami/`.

Le due librerie (`qr-code-styling` 1.9.2 e `jsQR` 1.4.0) arrivano da jsDelivr. Per un deploy completamente offline scaricale in `vendor/` e aggiorna i due `<script>` in fondo a `index.html`.

## Sviluppo locale

Qualsiasi server statico va bene:

```bash
python3 -m http.server 8080
```

## Note tecniche

- La quiet zone (4 moduli) e la cornice sono disegnate dal tool, non da qr-code-styling (`margin: 0`).
- Il testo viene pre-codificato in UTF-8 byte per byte prima di passarlo a qr-code-styling, che altrimenti tronca ogni carattere a un byte (accenti ed emoji arriverebbero corrotti ai lettori).
- Una vCard completa sono ~200 caratteri → 77×77 moduli con ECC H: il tool avvisa sopra i 150 caratteri. Per biglietti piccoli valuta un link alla pagina contatti.
- La verifica usa `inversionAttempts: 'dontInvert'`: un QR invertito (chiaro su scuro) viene segnalato ma non approvato, perché molti lettori non lo aprono.
- Il font della CTA è incorporato come `@font-face` solo nel PNG. Nell'SVG resta il riferimento a *Be Vietnam Pro* con fallback Helvetica/Arial: chi lo apre in Illustrator senza il font vedrà il fallback (o converte in tracciati).

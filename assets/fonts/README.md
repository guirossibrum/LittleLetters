# Worksheet fonts

- Block lettering fallback: ABeeZee.
- Calligraphy: Allura, Italianno, Sacramento, Parisienne, Dancing Script, Great Vibes, and Pinyon Script.

All eight fonts use the SIL Open Font License, version 1.1. Each font's copyright notice and complete license are included in its corresponding `*-OFL.txt` file. The font files are unmodified, regular-weight static TrueType fonts.

Allura and ABeeZee were already bundled. The six additional calligraphy fonts were added at the user's request on 2026-11-01. `download-sources.json` records their official source URLs and SHA-256 checksums, including their licenses. Five come from the official Google Fonts repository; the static Dancing Script Regular font comes from its official upstream project at a pinned revision. No system fonts are installed by the app.

The browser loads these TrueType files directly. The native PDF helper registers the same files with Fontconfig only inside its own process, and Cairo/Pango embeds the required lettering in exported PDFs. There is no generated base64 font-data script and no system font installation.

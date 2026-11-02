# Habblaud Desktop

Aplicație Windows: chat Claude Code în stânga (imagini, video, PDF, fișiere), biroul Habblaud și un terminal în dreapta.
Totul pornește în fundal: serverul Habblaud, procesele `claude`, instalarea Claude Code / Git / mod-ul Habblaud.

## Instalare

Descarcă `Habblaud-Setup-*.exe` din [Releases → desktop-latest](../../releases/tag/desktop-latest) și instalează.

## Construire locală

```powershell
npm install
npm run dist          # desktop\release\Habblaud-Setup-*.exe
npm run desktop       # pornește aplicația fără instalare
```

## Scurtături

| | |
|---|---|
| Enter / Shift+Enter | trimite / rând nou |
| Esc | oprește răspunsul |
| Ctrl+N | chat nou |
| Ctrl+K | caută conversații |
| Ctrl+B | ascunde lista |
| Ctrl+J | ascunde panoul din dreapta |

Atașamente: buton, drag & drop sau Ctrl+V. Video-urile sunt trimise ca 12 cadre (ffmpeg), PDF-urile ca documente,
fișierele text în mesaj, restul ca o cale pe disc pe care Claude o citește.

Bazat pe [Habblaud](https://github.com/marmottajr/habblaud) de Márcio Junior (MIT).

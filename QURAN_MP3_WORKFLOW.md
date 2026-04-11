# Quran Page-by-Page MP3 Creation Workflow

## Goal
Split Maher al-Muaiqly's (year 1440) recitation of Surah Al-Baqarah into 48 individual MP3 files, one per mushaf page (pages 2-49).

## The Source Audio
- **URL**: `https://download.quranicaudio.com/quran/maher_almu3aiqly/year1440//002.mp3`
- **File size**: 96,913,557 bytes (~92MB)
- **Duration**: 8,075 seconds (~2h14m)
- **Bitrate**: ~96kbps (VBR)
- **Format**: MP3

This is a single file containing the entire surah. The user found this URL via Chrome DevTools while playing audio on quran.com with this specific reciter selected.

## The Timing Data Problem

To split the full surah by mushaf page, we needed per-verse timestamps (which verse starts/ends at what millisecond), plus a mapping of which verses are on which page.

### Attempt 1: Direct QDC API (WRONG timestamps)
```
https://api.qurancdn.com/api/qdc/audio/reciters/159/audio_files?chapter=2&segments=true
```
Reciter ID **159** is Maher al-Muaiqly year 1440. We found this ID by scanning IDs 1-800 on the API and matching the `audio_url` field to the user's URL. IDs 52 (year1422-1423) and 65 (maher_256) were other Maher recordings but not year 1440.

**This returned wrong timestamps.** The verse timings didn't match the actual audio. For example, verse 2:6 had `timestamp_from: 49102ms` but the browser was seeking to byte offset 3,276,800 which corresponded to ~273 seconds — way off.

### Attempt 2: Quran.com Proxy API (CORRECT timestamps)
The user discovered in Chrome DevTools that quran.com's frontend hits a **proxy endpoint**:
```
https://quran.com/api/proxy/content/api/qdc/audio/reciters/159/audio_files?chapter=2&segments=true
```

**This returned completely different (correct) timestamps** from the direct API. For example:
- Direct API verse 2:1: `0ms - 12662ms`
- **Proxy API verse 2:1: `6790ms - 15440ms`** (starts at 6.8s because of Bismillah intro)
- Direct API verse 2:6: `49102ms - 60392ms`
- **Proxy API verse 2:6: `68430ms - 81840ms`**

The proxy response has 286 verse timing entries, each with `timestamp_from` and `timestamp_to` in milliseconds.

### Why the Discrepancy
We never fully resolved why the direct API and proxy API return different timestamps for the same reciter ID and audio file. The proxy likely has corrected/curated timing data that the direct API doesn't serve.

## The Page-to-Verse Mapping

From the quran.com API:
```
https://api.quran.com/api/v4/verses/by_chapter/2?fields=verse_key,page_number&per_page=286
```

This returns all 286 verses with their `page_number` field (Madani mushaf layout). Surah Al-Baqarah spans pages 2-49 (48 pages). We fetched this in one request since `per_page=286` covers all verses.

Page mapping examples:
- Page 2: verses 2:1 - 2:5
- Page 3: verses 2:6 - 2:16
- Page 48: verse 2:282 (just one verse — Ayat al-Dayn, the longest in the Quran)
- Page 49: verses 2:283 - 2:286

## The Split Process

### Step 1: Fetch timing data
```bash
curl -sS -H "User-Agent: Mozilla/5.0" -H "Referer: https://quran.com/" \
  "https://quran.com/api/proxy/content/api/qdc/audio/reciters/159/audio_files?chapter=2&segments=true" \
  -o /tmp/maher_timings.json
```
**Important**: The proxy requires `User-Agent` and `Referer` headers or it returns 403.

### Step 2: Fetch verse-to-page mapping
```bash
curl -sS -H "User-Agent: Mozilla/5.0" \
  "https://api.quran.com/api/v4/verses/by_chapter/2?fields=verse_key,page_number&per_page=286" \
  -o /tmp/baqarah_verses.json
```

### Step 3: Download the full surah
```bash
curl -sS -H "User-Agent: Mozilla/5.0" \
  "https://download.quranicaudio.com/quran/maher_almu3aiqly/year1440//002.mp3" \
  -o full_surah.mp3
```

### Step 4: Compute page boundaries
For each page, we find the minimum `timestamp_from` of its first verse and the maximum `timestamp_to` of its last verse from the proxy timing data.

**Special case for page 2 (first page)**: The proxy data had verse 2:1 starting at 6790ms, but we set the start to **0ms** because the Bismillah intro before verse 1 should be included.

### Step 5: Split with ffmpeg
```bash
ffmpeg -y -i full_surah.mp3 -ss {start_sec} -t {duration_sec} -c copy {output_file}
```

- `-ss`: Start time in seconds (from the proxy `timestamp_from` of the first verse on that page)
- `-t`: Duration in seconds (`timestamp_to` of last verse minus `timestamp_from` of first verse)
- `-c copy`: Stream copy, no re-encoding — preserves exact audio quality, very fast

### The Python Script
```python
import json, subprocess, os

OUT = '/path/to/output'
SURAH = os.path.join(OUT, 'full_surah.mp3')

with open('/tmp/maher_timings.json') as f:
    timings_data = json.load(f)
verse_timings = {
    t['verse_key']: (t['timestamp_from'], t['timestamp_to'])
    for t in timings_data['audio_files'][0]['verse_timings']
}

with open('/tmp/baqarah_verses.json') as f:
    verses_data = json.load(f)

# Group verses by page
pages = {}
for v in verses_data['verses']:
    pn = v['page_number']
    vn = int(v['verse_key'].split(':')[1])
    pages.setdefault(pn, []).append(vn)

for pn in sorted(pages):
    verses = sorted(pages[pn])
    first, last = verses[0], verses[-1]
    start_ms = verse_timings[f'2:{first}'][0]
    end_ms = verse_timings[f'2:{last}'][1]

    # Special case: page 2 starts from 0 (include Bismillah)
    if pn == 2:
        start_ms = 0

    start_sec = start_ms / 1000.0
    duration_sec = (end_ms - start_ms) / 1000.0

    filename = f'page_{pn:03d}_ayah_{first}-{last}.mp3'
    subprocess.run([
        'ffmpeg', '-y', '-i', SURAH,
        '-ss', f'{start_sec:.3f}',
        '-t', f'{duration_sec:.3f}',
        '-c', 'copy', os.path.join(OUT, filename)
    ], capture_output=True)
```

## Output
48 MP3 files named `page_002_ayah_1-5.mp3` through `page_049_ayah_283-286.mp3`, each ~1-2MB, totaling ~92MB. Stored in the `audio/` subdirectory.

## Key Gotchas for Reproduction
1. **Use the proxy endpoint, not the direct API** — timestamps are different and only the proxy ones match the actual audio
2. **Reciter ID 159** — not in the public reciters list, had to be discovered via DevTools
3. **Headers required** — the proxy needs `User-Agent` and `Referer: https://quran.com/`
4. **Page 2 starts at 0ms** — the proxy says verse 2:1 starts at ~6.8s but the Bismillah intro before it should be included
5. **`-c copy` for ffmpeg** — no re-encoding needed, preserves original quality
